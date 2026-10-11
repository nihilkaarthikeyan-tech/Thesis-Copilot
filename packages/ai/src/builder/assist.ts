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
import { nameTheSource } from './own-study.js';
import { isHeadingLine, splitSentences } from './quality.js';
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
/**
 * ADR-0082: the instruction a second Assist call gets when the first reused a passage's wording.
 * Sent through A.1's own `<instruction>` slot, so the prompt is unchanged (ADR-0038).
 */
export const REWORD_INSTRUCTION =
  'Your previous answer reused the wording of a passage. Say the same finding in your own words: a different sentence structure and different wording, no six consecutive words taken from any passage; keep the technical terms, names and figures exact, and keep the same citations.';

export type PromptPassage = {
  /** `S<sourceId>#c<chunkId>` — the only thing the model may cite (§10.6). */
  id: string;
  /** "Kumar 2021". */
  shortRef: string;
  page: number | null;
  text: string;
  /**
   * ADR-0074: an abstract a search found for chat, not a passage of the student's library. Chat
   * marks it in the prompt; every other builder ignores it.
   */
  origin?: 'search';
  /**
   * ADR-0147 round 6: the passage starts at the first sentence of the paper's abstract (the first
   * chunk of its "Abstract" section). At an opening, A.1 withholds that sentence; nothing else
   * reads this.
   */
  opensAbstract?: boolean;
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

/**
 * ADR-0147 round 6: the cursor opens an empty chapter or section. Nothing is written before it,
 * or the cursor is on a new line under a heading (`before` ends in a line break and its last line
 * is a heading, not a sentence). A new paragraph after a finished one is not an opening, and a
 * half-written sentence never is: it does not end in a line break.
 */
export function isOpening(before: string): boolean {
  if (before.trim() === '') return true;
  if (!/\n[ \t]*$/.test(before)) return false;
  const last = before.trimEnd().split('\n').pop() ?? '';
  return isHeadingLine(last);
}

/**
 * ADR-0147 round 6: a passage's text without its first sentence, when the passage opens the
 * abstract and the cursor opens a section. Five prompt rounds found the fast model restating a
 * fresh paper's opening line at an opening (22 words of one abstract, word for word), and a prompt
 * line forbidding it made it more frequent. A passage of one sentence is left whole, and so is
 * every passage on any other request. The id, reference and page do not change, and the copying
 * check (`closeToPassages`) still compares against the whole passage.
 */
export function withheldOpening(passage: PromptPassage, opening: boolean): string {
  if (!opening || passage.opensAbstract !== true) return passage.text;
  const sentences = splitSentences(passage.text);
  if (sentences.length < 2) return passage.text;
  return sentences.slice(1).join(' ');
}

/** A.1's user message, with `before`/`after` cut to FR-4.3's windows. */
export function assistUserMessage(input: AssistBuildInput): string {
  const template = loadPrompt('assist').user;
  if (!template) throw new Error('assist.md has no user message block');
  const opening = isOpening(input.before);

  return renderTemplate(template, {
    chapter: { title: input.chapter.title, scopeNote: input.chapter.scopeNote ?? '' },
    passages: input.passages.map((passage) => ({
      id: passage.id,
      shortRef: passage.shortRef,
      page: passage.page ?? '',
      // ADR-0078: a paper's "this study" about itself, named, so it never reaches the thesis.
      text: nameTheSource(withheldOpening(passage, opening), passage.shortRef),
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
