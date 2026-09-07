/**
 * Per-section scope regeneration — PRD FR-3.6, PHASES v2 B3.5.
 *
 *   "Per-section scope regeneration with sibling context."
 *
 * A student rewrites one chapter's scope note without touching the rest of the outline. The
 * siblings are in the prompt so the new note fits between them rather than swallowing what the
 * chapter before it already promises — which is the failure mode a whole-outline regeneration
 * avoids by construction and a single-node one has to be told about.
 *
 * It reuses A.9's system block: the rules for what a scope note is do not change because only one
 * node is being written.
 */

import { z } from 'zod';
import { loadPrompt } from '../prompts.js';
import type { LlmRequest } from '../types.js';
import { renderScope, type ScopeForQueries } from './queries.js';

export const SECTION_SCOPE = {
  tier: 'strong',
  maxTokens: 600,
  temperature: 0.3,
} as const;

export const sectionScopeSchema = z.object({
  title: z.string().trim().min(1).max(200),
  scopeNote: z.string().trim().min(1).max(2_000),
  targetWords: z.number().int().min(100).max(20_000).optional(),
  children: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        scopeNote: z.string().trim().max(2_000),
      }),
    )
    .max(12)
    .default([]),
});
export type SectionScopeResult = z.infer<typeof sectionScopeSchema>;

export type SectionScopeInput = {
  scope: ScopeForQueries;
  /** The node being rewritten, as it stands. */
  node: { id: string; title: string; scopeNote: string; role?: string };
  /** Its siblings in order, so the new note does not overlap them. */
  siblings: ReadonlyArray<{ title: string; scopeNote: string; position: 'before' | 'after' }>;
  /** What the student asked for, when they said anything. */
  instruction?: string | null;
  userId: string;
  documentId: string;
  signal?: AbortSignal;
};

export function sectionScopeUserMessage(input: SectionScopeInput): string {
  const before = input.siblings.filter((s) => s.position === 'before');
  const after = input.siblings.filter((s) => s.position === 'after');
  const render = (list: typeof before) =>
    list.map((s) => `- ${s.title}: ${s.scopeNote || '(no scope note)'}`).join('\n');

  return [
    renderScope(input.scope),
    '<chapters_before>',
    render(before),
    '</chapters_before>',
    `<target role="${input.node.role ?? 'Body'}">`,
    `Title: ${input.node.title}`,
    `Scope note: ${input.node.scopeNote || '(empty)'}`,
    '</target>',
    '<chapters_after>',
    render(after),
    '</chapters_after>',
    input.instruction?.trim()
      ? `<instruction>${input.instruction.trim()}</instruction>`
      : '<instruction>Rewrite the target chapter’s scope note so it is specific and does not repeat what the chapters before and after already cover.</instruction>',
    'Output JSON for the target chapter only: {"title","scopeNote","targetWords","children":[{"title","scopeNote"}]}.',
  ].join('\n');
}

export function buildSectionScopeRequest(input: SectionScopeInput): Omit<LlmRequest, 'schema'> {
  return {
    tier: SECTION_SCOPE.tier,
    system: { cached: `${loadPrompt('_preamble').system}\n\n${loadPrompt('outline').system}` },
    messages: [{ role: 'user', content: sectionScopeUserMessage(input) }],
    maxTokens: SECTION_SCOPE.maxTokens,
    temperature: SECTION_SCOPE.temperature,
    action: 'OUTLINE',
    userId: input.userId,
    documentId: input.documentId,
    ...(input.signal ? { signal: input.signal } : {}),
  };
}

/**
 * A mock that rewrites the note from what is actually in the request: the chapter's own title and
 * the scope's objectives, minus anything a sibling already promises. It invents no topic.
 */
export const mockSectionScopeResponse = {
  match: (req: { action: string; messages: ReadonlyArray<{ content: string }> }) =>
    req.action === 'OUTLINE' && (req.messages.at(-1)?.content ?? '').includes('<target role='),
  respond: (req: { messages: ReadonlyArray<{ content: string }> }): SectionScopeResult => {
    const text = req.messages.at(-1)?.content ?? '';
    const title = (/Title: (.*)/.exec(text)?.[1] ?? 'Chapter').trim();
    const objectives = [...text.matchAll(/^- (.*)$/gm)].map((m) => (m[1] ?? '').trim());
    const siblingWords = new Set(
      objectives
        .join(' ')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 5),
    );
    const own = title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 4 && !siblingWords.has(w));
    return {
      title,
      scopeNote: own.length
        ? `Covers ${own.join(', ')} for this thesis, without repeating what the neighbouring chapters set out (mock).`
        : `Covers what “${title}” promises, without repeating the neighbouring chapters (mock).`,
      children: [],
    };
  },
};
