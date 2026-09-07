/**
 * Comment classification and scoped revision — PRD §5.7, Appendix A.13, A.14, D.2, PHASES v2 B2.
 *
 * Two prompts with opposite risk profiles, and the difference is the point:
 *
 *   - A.13 reads a comment and labels it. Cheap, automatic, uncapped, logged.
 *   - A.14 rewrites the student's thesis. Never automatic, never in bulk for a `SUBSTANTIVE`
 *     comment, capped as `COMMAND`, and its output replaces exactly the anchored range and
 *     nothing else. If the comment asks for something the thesis does not contain, A.14 is
 *     required to say so with `[[NEEDS INPUT: …]]` rather than invent it — the same rule §10.6
 *     applies to citations.
 */

import { z } from 'zod';
import { loadPrompt } from '../prompts.js';
import type { LlmRequest } from '../types.js';
import type { PromptPassage } from './assist.js';

export const COMMENT = {
  classifyTier: 'fast',
  reviseTier: 'strong',
  classifyMaxTokens: 300,
  reviseMaxTokens: 1_200,
  /** A.14: "top 6 from the library for the target text". */
  revisePassages: 6,
  /** D.2.2: the similarity floor for re-anchoring a comment by its quoted text. */
  reanchorSimilarity: 0.85,
} as const;

// ---------------------------------------------------------------------------------------------
// A.13 — classification
// ---------------------------------------------------------------------------------------------

export const COMMENT_CLASSES = ['SUBSTANTIVE', 'CLARIFICATION', 'MECHANICAL'] as const;
export type CommentClass = (typeof COMMENT_CLASSES)[number];

export const classifySchema = z.object({
  class: z.enum(COMMENT_CLASSES),
  rationale: z.string().max(300).default(''),
  needsHumanRewrite: z.boolean().default(false),
});
export type ClassifyResult = z.infer<typeof classifySchema>;

export function buildClassifyRequest(input: {
  comment: string;
  quotedText?: string | null;
  chapterTitle: string;
  userId: string;
  documentId: string;
  signal?: AbortSignal;
}): Omit<LlmRequest, 'schema'> {
  const user = [
    `<comment>${input.comment}</comment>`,
    `<quoted_text>${input.quotedText ?? ''}</quoted_text>`,
    `<chapter_title>${input.chapterTitle}</chapter_title>`,
  ].join('\n');
  return {
    tier: COMMENT.classifyTier,
    system: {
      cached: `${loadPrompt('_preamble').system}\n\n${loadPrompt('comment_classify').system}`,
    },
    messages: [{ role: 'user', content: user }],
    maxTokens: COMMENT.classifyMaxTokens,
    temperature: 0,
    action: 'CLASSIFY_COMMENT',
    userId: input.userId,
    documentId: input.documentId,
    ...(input.signal ? { signal: input.signal } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// A.14 — scoped revision
// ---------------------------------------------------------------------------------------------

export type ReviseInput = {
  /** A.0 + A.0.1, cached — this is the one coherence-adjacent prompt that reuses the memory block. */
  memoryBlock: string;
  comment: string;
  commentClass: CommentClass;
  /** The anchored range expanded to paragraph boundaries (A.14). */
  target: string;
  contextBefore: string;
  contextAfter: string;
  passages: readonly PromptPassage[];
  userId: string;
  documentId: string;
  signal?: AbortSignal;
};

export function reviseUserMessage(input: ReviseInput): string {
  const passages = input.passages
    .slice(0, COMMENT.revisePassages)
    .map((p) => `<passage id="${p.id}" ref="${p.shortRef}">${p.text}</passage>`);
  return [
    `<comment class="${input.commentClass}">${input.comment}</comment>`,
    `<target>${input.target}</target>`,
    `<context_before>${input.contextBefore}</context_before>`,
    `<context_after>${input.contextAfter}</context_after>`,
    '<passages>',
    ...passages,
    '</passages>',
  ].join('\n');
}

export function buildReviseRequest(input: ReviseInput): LlmRequest {
  return {
    tier: COMMENT.reviseTier,
    system: {
      cached: `${loadPrompt('_preamble').system}\n\n${input.memoryBlock}`,
      volatile: loadPrompt('revise').system,
    },
    messages: [{ role: 'user', content: reviseUserMessage(input) }],
    maxTokens: COMMENT.reviseMaxTokens,
    temperature: 0.3,
    action: 'SCOPED_REVISION',
    userId: input.userId,
    documentId: input.documentId,
    ...(input.signal ? { signal: input.signal } : {}),
  };
}

export const NEEDS_INPUT_RE = /\[\[NEEDS INPUT:\s*([^\]]+)\]\]/g;

export type RevisionPostProcess = {
  text: string;
  /** What A.14 says the student must supply; shown, never guessed at. */
  needsInput: string[];
  /** Citation keys in the revision that were not in the passages sent — stripped (§10.6). */
  hallucinated: string[];
  /** True when the revision kept every citation the original had. */
  keptCitations: boolean;
};

const CITE_RE = /\{\{cite:([^}]+)\}\}/g;

function citeKeys(text: string): string[] {
  CITE_RE.lastIndex = 0;
  const out: string[] = [];
  let match: RegExpExecArray | null = CITE_RE.exec(text);
  while (match) {
    if (match[1]) out.push(match[1]);
    match = CITE_RE.exec(text);
  }
  return out;
}

/**
 * A.14's post-processing.
 *
 * The citation rule is the one worth stating: a revision may keep the citations the passage had
 * and may add one that a supplied passage supports, and anything else is stripped. A guide's
 * comment is not a licence to invent a source.
 */
export function postProcessRevision(
  raw: string,
  original: string,
  allowedIds: readonly string[],
): RevisionPostProcess {
  const needsInput: string[] = [];
  NEEDS_INPUT_RE.lastIndex = 0;
  let match: RegExpExecArray | null = NEEDS_INPUT_RE.exec(raw);
  while (match) {
    if (match[1]) needsInput.push(match[1].trim());
    match = NEEDS_INPUT_RE.exec(raw);
  }

  const allowed = new Set([...allowedIds, ...citeKeys(original)]);
  const hallucinated: string[] = [];
  const text = raw
    .replace(CITE_RE, (whole, key: string) => {
      if (allowed.has(key)) return whole;
      hallucinated.push(key);
      return '';
    })
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  const originalKeys = new Set(citeKeys(original));
  const revisedKeys = new Set(citeKeys(text));
  const keptCitations = [...originalKeys].every((key) => revisedKeys.has(key));

  return { text, needsInput, hallucinated, keptCitations };
}

// ---------------------------------------------------------------------------------------------
// Mocks (AI_PROVIDER=mock)
// ---------------------------------------------------------------------------------------------

/**
 * Classifies from the comment's own words — the verbs a guide uses are what the classes are
 * defined by. It never guesses at a class it cannot see evidence for and falls back to
 * CLARIFICATION, which is the class that costs the student the least if it is wrong.
 */
export const mockClassifyResponse = {
  match: (req: { action: string }) => req.action === 'CLASSIFY_COMMENT',
  respond: (req: { messages: ReadonlyArray<{ content: string }> }): ClassifyResult => {
    const comment = (
      /<comment>([\s\S]*?)<\/comment>/.exec(req.messages.at(-1)?.content ?? '')?.[1] ?? ''
    ).toLowerCase();
    const mechanical =
      /\b(typo|spelling|grammar|comma|full stop|citation style|format|caption|label|figure \d|table \d|reference list|apa|ieee)\b/.test(
        comment,
      );
    const substantive =
      /\b(wrong|incorrect|does not follow|unsupported|weak|rethink|reconsider|method|validity|invalid|contradict|overstat|conclusion|argument|sample size|confound)\b/.test(
        comment,
      );
    const cls: CommentClass = substantive
      ? 'SUBSTANTIVE'
      : mechanical
        ? 'MECHANICAL'
        : 'CLARIFICATION';
    return {
      class: cls,
      rationale: substantive
        ? 'Questions the argument or method (mock).'
        : mechanical
          ? 'Concerns wording or formatting (mock).'
          : 'Asks for more explanation (mock).',
      needsHumanRewrite: cls === 'SUBSTANTIVE',
    };
  },
};

/**
 * A revision that changes the minimum: it keeps the target passage and appends a
 * `[[NEEDS INPUT]]` line, because a mock cannot know what the guide wanted. That is exactly what
 * A.14 tells a real model to do when it lacks the information, so the flow the student sees —
 * review, decide, supply what is missing — is the real one.
 */
export function mockRevisionFor(req: { messages: ReadonlyArray<{ content: string }> }): string {
  const content = req.messages.at(-1)?.content ?? '';
  const target = /<target>([\s\S]*?)<\/target>/.exec(content)?.[1]?.trim() ?? '';
  const comment = /<comment[^>]*>([\s\S]*?)<\/comment>/.exec(content)?.[1]?.trim() ?? '';
  const ask = comment.split(/\s+/).slice(0, 10).join(' ');
  return `${target}\n[[NEEDS INPUT: what the guide asked for — ${ask}]]`;
}
