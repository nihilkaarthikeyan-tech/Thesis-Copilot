/**
 * Search query generation — PRD FR-2.5, Appendix A.7, PHASES 7.1.
 *
 * One Strong call per discovery run ("≤ 1 strong-tier call per search"): 4–6 keyword queries
 * from the scope, each with an angle. The `<scope>` block is the student's saved proposal
 * (FR-1.4: the edited values), and for Path B the library's titles are offered so the queries
 * look for adjacent work rather than what is already there.
 */

import { z } from 'zod';
import { loadPrompt } from '../prompts.js';
import type { LlmRequest } from '../types.js';

export const QUERIES = {
  tier: 'strong',
  maxTokens: 600,
  temperature: 0.7,
  min: 4,
  max: 6,
} as const;

export const QUERY_ANGLES = [
  'methodology',
  'domain',
  'comparative',
  'policy',
  'theory',
  'outcome',
] as const;

export const queriesSchema = z.object({
  queries: z
    .array(
      z.object({
        angle: z.enum(QUERY_ANGLES),
        q: z.string().trim().min(3).max(200),
      }),
    )
    .min(1)
    .max(12),
});
export type QueriesResult = z.infer<typeof queriesSchema>;

export type ScopeForQueries = {
  workingTitle: string;
  problemStatement: string;
  objectives: readonly string[];
  whyOpen?: string;
};

export type QueriesInput = {
  scope: ScopeForQueries;
  /** Titles already in the library (Path B), so the model looks for adjacent work. */
  existingTitles?: readonly string[];
  userId: string;
  documentId: string;
  signal?: AbortSignal;
};

export function renderScope(scope: ScopeForQueries): string {
  return [
    '<scope>',
    `Working title: ${scope.workingTitle}`,
    `Problem statement: ${scope.problemStatement}`,
    'Objectives:',
    ...scope.objectives.map((o) => `- ${o}`),
    ...(scope.whyOpen ? [`Why open: ${scope.whyOpen}`] : []),
    '</scope>',
  ].join('\n');
}

export function queriesUserMessage(input: QueriesInput): string {
  const parts = [renderScope(input.scope)];
  if (input.existingTitles && input.existingTitles.length > 0) {
    parts.push(
      [
        '<existing_sources>',
        ...input.existingTitles.slice(0, 60).map((t) => `- ${t}`),
        '</existing_sources>',
        'Prefer queries that would find work adjacent to these.',
      ].join('\n'),
    );
  }
  return parts.join('\n\n');
}

export function buildQueriesRequest(input: QueriesInput): Omit<LlmRequest, 'schema'> {
  return {
    tier: QUERIES.tier,
    system: { cached: `${loadPrompt('_preamble').system}\n\n${loadPrompt('queries').system}` },
    messages: [{ role: 'user', content: queriesUserMessage(input) }],
    maxTokens: QUERIES.maxTokens,
    temperature: QUERIES.temperature,
    action: 'SEARCH_QUERIES',
    userId: input.userId,
    documentId: input.documentId,
    ...(input.signal ? { signal: input.signal } : {}),
  };
}

/** A.7 rules, checked in code: 4–10 words, keyword style, no quotes, not the title verbatim. */
export function cleanQueries(result: QueriesResult, title: string): QueriesResult['queries'] {
  const seen = new Set<string>();
  const out: QueriesResult['queries'] = [];
  for (const query of result.queries) {
    const q = query.q.replace(/["“”?]/g, '').replace(/\s+/g, ' ').trim();
    const words = q.split(' ').filter(Boolean);
    if (words.length < 3 || words.length > 12) continue;
    if (q.toLowerCase() === title.trim().toLowerCase()) continue;
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ angle: query.angle, q });
    if (out.length === QUERIES.max) break;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Mock (AI_PROVIDER=mock)
// ---------------------------------------------------------------------------------------------

const STOP = new Set(
  'a an the of in on for to and or with by from at as is are be this that these those into among between across using toward towards what how why'.split(
    ' ',
  ),
);

function keywords(text: string, n: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9-]+/)) {
    if (raw.length < 3 || STOP.has(raw) || seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
    if (out.length === n) break;
  }
  return out;
}

/** A.7-shaped queries built only from the scope's own words; nothing is invented. */
export const mockQueriesResponse = {
  match: (req: { action: string }) => req.action === 'SEARCH_QUERIES',
  respond: (req: { messages: ReadonlyArray<{ content: string }> }): QueriesResult => {
    const text = req.messages.at(-1)?.content ?? '';
    const title = /Working title: (.*)/.exec(text)?.[1] ?? '';
    const problem = /Problem statement: (.*)/.exec(text)?.[1] ?? '';
    const objectives = [...text.matchAll(/^- (.*)$/gm)].map((m) => m[1] ?? '');
    const base = keywords(`${title} ${problem}`, 5);
    const obj = keywords(objectives.join(' '), 5);
    const mk = (angle: QueriesResult['queries'][number]['angle'], words: string[]) => ({
      angle,
      q: words.slice(0, 6).join(' '),
    });
    return {
      queries: [
        mk('domain', base),
        mk('methodology', [...base.slice(0, 3), 'survey', 'method']),
        mk('comparative', [...base.slice(0, 3), 'comparison', 'districts']),
        mk('outcome', obj.length >= 3 ? obj : [...base.slice(0, 3), 'outcomes', 'adoption']),
      ].filter((q) => q.q.split(' ').length >= 3),
    };
  },
};
