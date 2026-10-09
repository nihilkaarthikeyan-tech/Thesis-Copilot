/**
 * Strengths and questions for the author — ADR-0131 (Jenni build plan (a) item 4, coverage row 55).
 *
 * Jenni's peer review ends with what the paper does well and the questions a reviewer would put to
 * its author. Our examiner review (ADR-0056) reported issues only. The review of a whole chapter
 * now asks each section's examiner call, inside the same call and the same `EXAMINER_REVIEW` unit,
 * for a few of each as well (`examiner_review.md`: `examiner.md`'s issues part word for word, with
 * a strengths part and a questions part). No new call, so no new allowance; the cost is a little
 * more output per section (docs/COSTING.md).
 *
 * The model's words are not trusted in either part:
 *
 * - **A strength points at the chapter.** Its `quote` must be found, as words, in a sentence of the
 *   section the call read; it is pinned to that sentence (positions included, so "Go to" works) or
 *   dropped. A strength on a sentence with a blocking issue is dropped.
 * - **A question asks about the chapter, and asserts nothing outside it.** It must share a content
 *   word with the section; any year and any "Name et al." in it must appear in the section or its
 *   passages; no passage ids. Anything else is dropped.
 *
 * The chapter keeps at most four strengths and five questions, taken from its sections in turn.
 * The selection review (ADR-0067) keeps `examiner.md`: a paragraph has no strengths to report.
 */

import { z } from 'zod';
import { loadPrompt } from '../prompts.js';
import type { LlmRequest } from '../types.js';
import {
  buildExaminerRequest,
  type ExaminerInput,
  type ExaminerResult,
  examinerSchema,
  mockExaminerFor,
} from './chapter-build.js';

export const EXAMINER_HIGHLIGHTS = {
  /** What the chapter shows at most. */
  strengths: 4,
  questions: 5,
  /** Asked for beyond those, over the chapter, so a dropped one can be replaced. */
  spare: 1,
  /**
   * How many sections are asked at all: the largest two (round 3). The others are reviewed by
   * `examiner.md` exactly as before, so a review of eight sections pays for the longer answer
   * twice, not eight times.
   */
  sections: 2,
  /**
   * The examiner's 1,500 plus room for the two new lists (the prompt's header says the same).
   * Round 1 asked for 2,000 and a 50-sentence section's answer twice failed its schema, cut off.
   */
  maxTokens: 2_600,
  /** Words a strength's quote must have to pin it to one sentence. */
  quoteMinWords: 3,
  questionMaxWords: 60,
  whyChars: 300,
} as const;

/** No `.default()`, no `.max()`: OpenAI's strict mode refuses both (CLAUDE.md); bounds are code. */
export const examinerReviewSchema = z.object({
  issues: examinerSchema.shape.issues,
  strengths: z.array(z.object({ sentenceId: z.string(), quote: z.string(), why: z.string() })),
  questions: z.array(z.object({ sentenceId: z.string(), question: z.string() })),
});
export type ExaminerReviewAnswer = z.infer<typeof examinerReviewSchema>;

export type SectionAsk = { strengths: number; questions: number };

/**
 * How many of each one section's call may give: four strengths and five questions, plus a spare
 * of each, dealt one at a time over the largest two sections (ties to the earlier). A one-section
 * chapter asks its one call for all of them; every other section is asked for none, and its call
 * is `examiner.md`'s (`asksHighlights`).
 */
export function askPlan(sectionSizes: readonly number[]): SectionAsk[] {
  const plan = sectionSizes.map(() => ({ strengths: 0, questions: 0 }));
  if (plan.length === 0) return plan;
  const order = sectionSizes
    .map((size, index) => ({ size, index }))
    .sort((a, b) => b.size - a.size || a.index - b.index)
    .map((x) => x.index)
    .slice(0, EXAMINER_HIGHLIGHTS.sections);
  const deal = (key: keyof SectionAsk, total: number) => {
    for (let i = 0; i < total; i++) {
      const at = plan[order[i % order.length] as number] as SectionAsk;
      at[key] += 1;
    }
  };
  deal('strengths', EXAMINER_HIGHLIGHTS.strengths + EXAMINER_HIGHLIGHTS.spare);
  deal('questions', EXAMINER_HIGHLIGHTS.questions + EXAMINER_HIGHLIGHTS.spare);
  return plan;
}

/** True when a section's call is asked for strengths or questions (else it is `examiner.md`'s). */
export const asksHighlights = (ask: SectionAsk | null | undefined): ask is SectionAsk =>
  !!ask && (ask.strengths > 0 || ask.questions > 0);

/**
 * The examiner request for one section of a whole-chapter review: `examiner.md`'s request with
 * `examiner_review.md` as the system block and the `<ask>` line inside `<review>`.
 */
export function buildExaminerReviewHighlightsRequest(
  input: ExaminerInput,
  ask: SectionAsk,
): Omit<LlmRequest, 'schema'> {
  const base = buildExaminerRequest(input);
  const user = base.messages[0]?.content ?? '';
  const askLine = `<ask strengths="${Math.max(0, Math.floor(ask.strengths))}" questions="${Math.max(0, Math.floor(ask.questions))}"/>`;
  const at = user.lastIndexOf('</review>');
  const content = at < 0 ? `${user}\n${askLine}` : `${user.slice(0, at)}${askLine}\n</review>`;
  return {
    ...base,
    system: {
      cached: `${loadPrompt('_preamble').system}\n\n${loadPrompt('examiner_review').system}`,
    },
    messages: [{ role: 'user', content }],
    maxTokens: EXAMINER_HIGHLIGHTS.maxTokens,
    action: 'EXAMINER_REVIEW',
  };
}

/** The issues part, in the shape `postProcessExaminer` reads. */
export const issuesOf = (result: ExaminerReviewAnswer): ExaminerResult => ({
  issues: result.issues,
});

// --------------------------------------------------------------------------------------------
// Words
// --------------------------------------------------------------------------------------------

const stripMarkers = (text: string) => text.replace(/\{\{cite:[^}]*\}\}/g, ' ');

/** Lower-case words, quotes and dashes folded, citation markers left out. */
export function reviewWords(text: string): string[] {
  return (
    stripMarkers(text)
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[‘’ʼ]/g, "'")
      .match(/[\p{L}\p{N}]+(?:'[\p{L}]+)?/gu) ?? []
  );
}

/** True when `needle`'s words appear, in order and together, in `hay`'s. */
export function containsWords(hay: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || needle.length > hay.length) return false;
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

/** Words a question about any chapter would use; sharing one of these says nothing. */
const GENERIC = new Set(
  `about above after again against among another author authors based because before being
  below between beyond chapter chapters choice choose chose claim claims clear could defend
  define described discuss does doing during evidence examiner explain extent field finding
  findings further given having however implications justify might other others their there
  these thesis those through under using which while within without would research section
  sections study studies paper papers literature review result results argument approach method
  methods analysis would should whether where what when your yours rather since still argue
  support supports supported suggest suggests particular specific specifically example examples
  current present future reader readers state states stated work works point points account
  precise precisely exact exactly`
    .split(/\s+/)
    .filter(Boolean),
);

/** The section's words a question can share: five letters or more, not generic. */
export function contentWords(text: string): Set<string> {
  return new Set(reviewWords(text).filter((w) => w.length >= 5 && !GENERIC.has(w)));
}

// --------------------------------------------------------------------------------------------
// Post-processing
// --------------------------------------------------------------------------------------------

export type Strength = { sentenceId: string; quote: string; why: string };
export type Question = { sentenceId: string | null; question: string };

export type HighlightsInput = {
  /** The section's sentences as sent (`{{cite:Pn}}` markers allowed). */
  sentences: ReadonlyArray<{ id: string; text: string }>;
  passages: ReadonlyArray<{ id: string; text: string }>;
  title: string;
  /** Sentence ids with a blocking issue after post-processing. */
  blockingIds: ReadonlySet<string>;
};

const YEAR = /\b(1[89]\d{2}|20\d{2})\b/g;
const ET_AL = /\b(\p{Lu}[\p{L}'-]+)\s+et\s+al\b/gu;
const PASSAGE_ID = /\bP\d+\b|\{\{cite:/;

/**
 * Why a question is dropped, or null when it stands. Exported so the evaluation can count the
 * model's raw questions against the same rules.
 */
export function questionFault(question: string, input: HighlightsInput): string | null {
  const q = question.trim();
  if (!q.endsWith('?')) return 'not a question';
  const n = reviewWords(q).length;
  if (n < 4 || n > EXAMINER_HIGHLIGHTS.questionMaxWords) return 'length';
  if (PASSAGE_ID.test(q)) return 'passage id';
  const sectionText = [input.title, ...input.sentences.map((s) => s.text)].join(' ');
  const known = `${sectionText} ${input.passages.map((p) => p.text).join(' ')}`.toLowerCase();
  for (const m of q.matchAll(YEAR)) if (!known.includes(m[1] as string)) return 'outside year';
  for (const m of q.matchAll(ET_AL)) {
    if (!known.includes((m[1] as string).toLowerCase())) return 'outside author';
  }
  const own = contentWords(sectionText);
  if (!reviewWords(q).some((w) => own.has(w))) return 'not about the section';
  return null;
}

/** Where a strength's quote is: the sentence named when it holds there, else the first that has it. */
export function anchorStrength(quote: string, sentenceId: string, input: HighlightsInput) {
  const needle = reviewWords(quote);
  if (needle.length < EXAMINER_HIGHLIGHTS.quoteMinWords) return null;
  const named = input.sentences.find((s) => s.id === sentenceId.trim());
  if (named && containsWords(reviewWords(named.text), needle)) return named.id;
  return input.sentences.find((s) => containsWords(reviewWords(s.text), needle))?.id ?? null;
}

/**
 * A strength's reason without the request's own ids, which mean nothing to the student. Round 2
 * wrote "…cites the empirical Udupi study (P5)" and once ended a reason with "{{cite:P1}}".
 */
export function cleanWhy(why: string): string {
  return why
    .replace(/\{\{cite:[^}]*\}\}/g, '')
    .replace(/\s*\((?:P\d+(?:\s*(?:,|and)\s*)?)+\)/g, '')
    .replace(/\bP\d+\b/g, 'the cited source')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .trim();
}

export function postProcessHighlights(
  result: Pick<ExaminerReviewAnswer, 'strengths' | 'questions'>,
  input: HighlightsInput,
): {
  strengths: Strength[];
  questions: Question[];
  dropped: { strengths: number; questions: number };
} {
  const strengths: Strength[] = [];
  const pinned = new Set<string>();
  let droppedStrengths = 0;
  for (const raw of result.strengths ?? []) {
    const id = anchorStrength(raw.quote, raw.sentenceId, input);
    const why = cleanWhy(raw.why).slice(0, EXAMINER_HIGHLIGHTS.whyChars);
    if (!id || !why || input.blockingIds.has(id) || pinned.has(id)) {
      droppedStrengths++;
      continue;
    }
    pinned.add(id);
    strengths.push({ sentenceId: id, quote: raw.quote.trim().replace(/^["“]|["”]$/g, ''), why });
  }

  const questions: Question[] = [];
  const seen = new Set<string>();
  const ids = new Set(input.sentences.map((s) => s.id));
  let droppedQuestions = 0;
  for (const raw of result.questions ?? []) {
    const question = raw.question.trim().replace(/\s+/g, ' ');
    const key = reviewWords(question).join(' ');
    if (questionFault(question, input) || seen.has(key)) {
      droppedQuestions++;
      continue;
    }
    seen.add(key);
    const sentenceId = ids.has(raw.sentenceId.trim()) ? raw.sentenceId.trim() : null;
    questions.push({ sentenceId, question });
  }
  return {
    strengths,
    questions,
    dropped: { strengths: droppedStrengths, questions: droppedQuestions },
  };
}

/** Two questions on the same point: three content words or more shared, and over a third. */
export function sameQuestion(a: string, b: string): boolean {
  const x = contentWords(a);
  const y = contentWords(b);
  if (x.size === 0 || y.size === 0) return false;
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared >= 3 && shared / Math.min(x.size, y.size) >= 0.35;
}

/**
 * The chapter's lists: its sections' strengths and questions taken in turn, up to the limits. A
 * question on the same point as one already taken (two sections often ask the same) is skipped.
 */
export function pickHighlights<S, Q extends { question: string } | string>(
  sections: ReadonlyArray<{ strengths: readonly S[]; questions: readonly Q[] }>,
): { strengths: S[]; questions: Q[] } {
  const take = <T>(
    lists: ReadonlyArray<readonly T[]>,
    limit: number,
    same: (a: T, b: T) => boolean = () => false,
  ): T[] => {
    const out: T[] = [];
    for (let round = 0; out.length < limit; round++) {
      let any = false;
      for (const list of lists) {
        const item = list[round];
        if (item === undefined) continue;
        any = true;
        if (out.length < limit && !out.some((o) => same(o, item))) out.push(item);
      }
      if (!any) break;
    }
    return out;
  };
  const text = (q: Q) => (typeof q === 'string' ? q : q.question);
  return {
    strengths: take(
      sections.map((s) => s.strengths),
      EXAMINER_HIGHLIGHTS.strengths,
    ),
    questions: take(
      sections.map((s) => s.questions),
      EXAMINER_HIGHLIGHTS.questions,
      (a, b) => sameQuestion(text(a), text(b)),
    ),
  };
}

/**
 * The mock: `mockExaminerFor`'s issues, a strength on the first sentence without one, and a
 * question about the first sentence's longest word — as many as the `<ask>` line allows.
 */
export function mockExaminerReviewFor(req: LlmRequest): ExaminerReviewAnswer {
  const { issues } = mockExaminerFor(req);
  const user = req.messages.find((m) => m.role === 'user')?.content ?? '';
  const ask = user.match(/<ask strengths="(\d+)" questions="(\d+)"\/>/);
  const wantS = Number(ask?.[1] ?? 0);
  const wantQ = Number(ask?.[2] ?? 0);
  const sentences = [...user.matchAll(/<s id="(s\d+)">([\s\S]*?)<\/s>/g)];
  const flagged = new Set(issues.map((i) => i.sentenceId));
  const strengths: ExaminerReviewAnswer['strengths'] = [];
  const questions: ExaminerReviewAnswer['questions'] = [];
  for (const [, id, text] of sentences) {
    const plain = stripMarkers(text ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    const w = plain.split(' ');
    if (strengths.length < wantS && !flagged.has(id as string) && w.length >= 4) {
      strengths.push({
        sentenceId: id as string,
        quote: w
          .slice(0, Math.min(8, w.length))
          .join(' ')
          .replace(/[.,;:]$/, ''),
        why: 'States its point precisely and ties it to the cited evidence.',
      });
    }
    if (questions.length < wantQ) {
      const term = [...w].sort((a, b) => b.length - a.length)[0]?.replace(/[^\p{L}\p{N}-]/gu, '');
      if (term && term.length >= 5) {
        questions.push({
          sentenceId: id as string,
          question: `How would you defend the role you give to ${term.toLowerCase()} here against an examiner who doubts it?`,
        });
      }
    }
  }
  return { issues, strengths, questions };
}
