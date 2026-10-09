/**
 * The examiner's score card — ADR-0111, Jenni build plan R24.
 *
 * Jenni's peer review ends with scores: soundness, presentation, contribution and overall, out of
 * ten. Our examiner review (ADR-0056) reported issues only. One more call at the end of a review
 * of a whole chapter reads the chapter and the issues the sections' reviews wrote, and grades it
 * on a fixed scale (`examiner_scores.md`). Inside the same `EXAMINER_REVIEW` unit.
 *
 * The scores are an examiner's opinion of the chapter, never a fact about it, so the code is
 * strict about what it shows: a card with any score missing is not shown at all, and soundness is
 * held at 6 or below when the review wrote a blocking issue of a soundness type — the prompt's own
 * rule, kept here too.
 */

import { z } from 'zod';
import { loadPrompt } from '../prompts.js';
import type { LlmRequest } from '../types.js';
import { cleanBuildText } from './chapter-build.js';
import type { ReviewSection } from './examiner-review.js';

export const EXAMINER_SCORES = {
  tier: 'strong',
  /** 500 for the card, 200 more for the reading written before it (v3). */
  maxTokens: 700,
  temperature: 0,
  /**
   * Round 5 (ADR-0111 addendum, 2026-10-09): the strong tier's default `'low'` gave a card that
   * echoed the issue list; this one call thinks harder. Ignored by a model that does not reason.
   */
  reasoningEffort: 'high',
  /** Characters of the chapter sent; a longer chapter is cut, each section keeping its share. */
  chapterChars: 24_000,
  /** Issues listed, blocking first. */
  maxIssues: 40,
  /** Soundness when the review wrote a blocking issue (the prompt's rule, kept in code). */
  soundnessCeilingWithBlocking: 6,
  reasonChars: 240,
} as const;

export const SCORE_NAMES = ['soundness', 'presentation', 'contribution', 'overall'] as const;
export type ScoreName = (typeof SCORE_NAMES)[number];

export type ExaminerScores = Record<ScoreName, { score: number; reason: string }>;

/** Reason first: the model writes what it saw before it picks the number. */
const one = z.object({ reason: z.string(), score: z.number() });
/** No `.max()`, no `.default()`: OpenAI's strict mode refuses both (CLAUDE.md); bounds are code. */
export const examinerScoresSchema = z.object({
  /** v3: the model's own reading of the chapter's order and coverage, written before any score. */
  reading: z.string(),
  soundness: one,
  presentation: one,
  contribution: one,
  overall: one,
});

export type ScoreIssue = {
  severity: 'blocking' | 'warning';
  /** The examiner's `issueType` ("unsupported", "tense", …), so each score weighs its own kind. */
  type: string;
  section: string;
  explanation: string;
};

/** The issue types that bear on soundness (the prompt names the same five). */
export const SOUNDNESS_TYPES: readonly string[] = [
  'inaccuracy',
  'unsupported',
  'contradiction',
  'different_subject',
  'pitfall',
];

/** Blocking issues of a soundness type: what holds soundness at 6. */
export function soundnessBlocking(
  issues: readonly Pick<ScoreIssue, 'severity' | 'type'>[],
): number {
  return issues.filter((i) => i.severity === 'blocking' && SOUNDNESS_TYPES.includes(i.type)).length;
}

export type ExaminerScoresInput = {
  discipline: string;
  degree: string;
  chapterTitle: string;
  purpose: string;
  sections: readonly Pick<ReviewSection, 'title' | 'sentences'>[];
  issues: readonly ScoreIssue[];
  userId: string;
  documentId: string;
};

const attr = (text: string): string => cleanBuildText(text).replace(/"/g, '”');

/** Each section's sentences, cut so the whole chapter fits `chapterChars`, each keeping a share. */
function sectionTexts(sections: ExaminerScoresInput['sections']): string[] {
  const full = sections.map((s) =>
    cleanBuildText(s.sentences.map((x) => x.plain).join(' ')).replace(/\s+/g, ' '),
  );
  const total = full.reduce((n, t) => n + t.length, 0);
  if (total <= EXAMINER_SCORES.chapterChars) return full;
  const share = EXAMINER_SCORES.chapterChars / total;
  return full.map((t) => {
    const keep = Math.max(200, Math.floor(t.length * share));
    return t.length <= keep ? t : `${t.slice(0, keep).replace(/\s+\S*$/, '')} […]`;
  });
}

export function examinerScoresUserMessage(input: ExaminerScoresInput): string {
  const texts = sectionTexts(input.sections);
  const issues = [...input.issues]
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'blocking' ? -1 : 1))
    .slice(0, EXAMINER_SCORES.maxIssues);
  return [
    `<scores discipline="${attr(input.discipline)}" degree="${attr(input.degree)}">`,
    `<chapter title="${attr(input.chapterTitle)}" purpose="${attr(input.purpose)}">`,
    ...input.sections.map((s, i) => `<section title="${attr(s.title)}">${texts[i]}</section>`),
    '</chapter>',
    '<issues>',
    ...issues.map(
      (i) =>
        `<issue severity="${i.severity}" type="${attr(i.type)}" section="${attr(i.section)}">${cleanBuildText(i.explanation)}</issue>`,
    ),
    '</issues>',
    '</scores>',
  ].join('\n');
}

export function buildExaminerScoresRequest(input: ExaminerScoresInput): Omit<LlmRequest, 'schema'> {
  return {
    tier: EXAMINER_SCORES.tier,
    system: {
      cached: `${loadPrompt('_preamble').system}\n\n${loadPrompt('examiner_scores').system}`,
    },
    messages: [{ role: 'user', content: examinerScoresUserMessage(input) }],
    maxTokens: EXAMINER_SCORES.maxTokens,
    temperature: EXAMINER_SCORES.temperature,
    reasoningEffort: EXAMINER_SCORES.reasoningEffort,
    // Inside the review's own unit: logged against EXAMINER_REVIEW, never a second unit.
    action: 'EXAMINER_REVIEW',
    userId: input.userId,
    documentId: input.documentId,
  };
}

function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const end = flat.search(/[.!?](\s|$)/);
  const sentence = end >= 0 ? flat.slice(0, end + 1) : flat;
  return sentence.length > EXAMINER_SCORES.reasonChars
    ? `${sentence.slice(0, EXAMINER_SCORES.reasonChars - 1).trimEnd()}…`
    : sentence;
}

/**
 * The card as shown, or null. Every score a whole number from 1 to 10; one that is missing or not
 * a number drops the card rather than show a grade the model did not give.
 */
export function cleanExaminerScores(
  raw: unknown,
  /** `blocking`: blocking issues of a soundness type (`soundnessBlocking`). */
  options: { blocking: number },
): ExaminerScores | null {
  const parsed = examinerScoresSchema.safeParse(raw);
  if (!parsed.success) return null;
  const out = {} as ExaminerScores;
  for (const name of SCORE_NAMES) {
    const { score, reason } = parsed.data[name];
    if (!Number.isFinite(score)) return null;
    let value = Math.min(10, Math.max(1, Math.round(score)));
    if (name === 'soundness' && options.blocking > 0) {
      value = Math.min(value, EXAMINER_SCORES.soundnessCeilingWithBlocking);
    }
    out[name] = { score: value, reason: firstSentence(reason) };
  }
  return out;
}

/** The mock provider's answer: a middling card that names nothing it did not read. */
export const mockExaminerScoresResponse = {
  match: (req: LlmRequest) => req.messages.some((m) => m.content.startsWith('<scores')),
  value: {
    reading: 'Mock: each section follows from the one before; nothing required is missing.',
    soundness: { score: 7, reason: 'Mock: the claims checked against their passages held.' },
    presentation: { score: 7, reason: 'Mock: the sections follow the order the title promises.' },
    contribution: {
      score: 6,
      reason: 'Mock: the chapter restates its sources more than it argues.',
    },
    overall: { score: 7, reason: 'Mock: sound, with minor revisions.' },
  },
};
