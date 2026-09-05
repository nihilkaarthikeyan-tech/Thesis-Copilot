/**
 * The Assist request — PRD A.1 (`assist.md`), §10.3 and FR-4.3.
 *
 *   A.1: "Tier: Fast. Max output: 120 tokens. Temperature: 0.4. Cached: A.0 + A.0.1.
 *         Volatile: the user message below."
 *   FR-4.3: "cached system block (outline, glossary, style profile, scope) + uncached user block
 *         (chapter title, ~1,200 tokens before cursor, ~300 after, retrieved chunks, optional
 *         guided instruction)"
 *
 * The cached block is preamble + memory + A.1's task block, in that order, joined the same way
 * every time — the join is part of the cache key. Everything that varies per keystroke goes in
 * the user message.
 */

import { loadPrompt } from '../prompts.js';
import { renderTemplate } from '../template.js';
import type { LlmRequest } from '../types.js';
import { headByTokens, tailByTokens } from './tokens.js';

/** A.1's parameters, kept together so a test can pin them. */
export const ASSIST = {
  tier: 'fast',
  maxTokens: 120,
  temperature: 0.4,
  /** FR-4.3: "~1,200 tokens before cursor, ~300 after". */
  beforeTokens: 1_200,
  afterTokens: 300,
} as const;

/** One retrieved chunk as A.1's `<passage>` shows it. */
export type PromptPassage = {
  /** `S<sourceId>#c<chunkId>` — the only thing the model may cite (§10.6). */
  id: string;
  /** "Kumar 2021". */
  shortRef: string;
  page: number | null;
  text: string;
};

export type AssistBuildInput = {
  /** The rendered A.0.1 block, from `buildMemoryBlock`. */
  memoryBlock: string;
  chapter: { title: string; scopeNote: string | null };
  passages: readonly PromptPassage[];
  before: string;
  after: string;
  /** The guided instruction (Shift+→), or nothing. */
  instruction?: string | null;
  userId: string;
  documentId: string;
  signal?: AbortSignal;
};

/** How the three cached parts are joined. Changing this invalidates every cached prefix. */
const CACHED_JOIN = '\n\n';

/** The byte-stable cached block: A.0 + A.0.1 + A.1's task block. */
export function assistCachedBlock(memoryBlock: string): string {
  const preamble = loadPrompt('_preamble').system.trim();
  const task = loadPrompt('assist').system.trim();
  return [preamble, memoryBlock.trim(), task].join(CACHED_JOIN);
}

/** A.1's user message, with `before`/`after` cut to FR-4.3's windows. */
export function assistUserMessage(input: AssistBuildInput): string {
  const template = loadPrompt('assist').user;
  if (!template) throw new Error('assist.md has no user message block');

  return renderTemplate(template, {
    chapter: { title: input.chapter.title, scopeNote: input.chapter.scopeNote ?? '' },
    passages: input.passages.map((passage) => ({
      id: passage.id,
      shortRef: passage.shortRef,
      page: passage.page ?? '',
      text: passage.text,
    })),
    before: tailByTokens(input.before, ASSIST.beforeTokens),
    after: headByTokens(input.after, ASSIST.afterTokens),
    instruction_or_none: input.instruction?.trim() || 'none',
  });
}

export function buildAssistRequest(input: AssistBuildInput): LlmRequest {
  return {
    tier: ASSIST.tier,
    system: { cached: assistCachedBlock(input.memoryBlock) },
    messages: [{ role: 'user', content: assistUserMessage(input) }],
    maxTokens: ASSIST.maxTokens,
    temperature: ASSIST.temperature,
    action: 'ASSIST',
    userId: input.userId,
    documentId: input.documentId,
    ...(input.signal ? { signal: input.signal } : {}),
  };
}
