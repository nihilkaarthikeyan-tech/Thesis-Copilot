/**
 * Viva preparation — ADR-0030. Questions an examiner could ask about the student's own thesis,
 * and feedback on the answers the student types.
 *
 * Two rules from the rest of the product hold here, and code enforces both rather than the prompt:
 *
 * - **Grounding (§10.6).** A question names the passage of the thesis it is about; a question whose
 *   passage id was not in the request is dropped, as a citation to an unsent passage is stripped.
 *   A quotation in the feedback is shown only if it is in the named passage word for word
 *   (`verbatimQuote`, the support check's own test).
 * - **The student owns the thesis.** Nothing here writes into it, and the feedback names what an
 *   answer is missing without writing the answer: the viva is the student's to give.
 *
 * Metered as its own action, `VIVA`: one unit for a question set, one for feedback on one answer.
 */

import { z } from 'zod';
import { loadPrompt } from '../prompts.js';
import type { LlmRequest } from '../types.js';
import { verbatimQuote } from './coherence.js';

export const VIVA = {
  questions: { tier: 'strong', maxTokens: 1_500, temperature: 0.4 },
  feedback: { tier: 'strong', maxTokens: 900, temperature: 0 },
  maxQuestions: 8,
  /** Passages of the thesis sent for a question set, spread across the chapters. */
  maxPassages: 20,
  /** A passage is a paragraph cut to this many words. */
  passageWords: 120,
  /** A paragraph shorter than this is a heading-like line, not something to be examined on. */
  minPassageWords: 25,
  /** Below this there is not enough thesis to examine. */
  minPassages: 3,
  /** Passages sent with an answer: the question's own, and this many more that the answer touches. */
  relatedPassages: 3,
  answerMinWords: 5,
  answerMaxChars: 4_000,
} as const;

export const VIVA_KINDS = [
  'contribution',
  'method',
  'literature',
  'results',
  'limitations',
  'implications',
] as const;
export type VivaKind = (typeof VIVA_KINDS)[number];

export const VIVA_VERDICTS = ['strong', 'partial', 'weak'] as const;
export type VivaVerdict = (typeof VIVA_VERDICTS)[number];

export type VivaPassage = { id: string; chapterTitle: string; text: string };

/** Strict-mode friendly, as `proofreadSchema` is: no defaults, no limits — post-processing trims. */
export const vivaQuestionsSchema = z.object({
  questions: z.array(
    z.object({
      passageId: z.string(),
      kind: z.string(),
      question: z.string(),
      probing: z.string(),
    }),
  ),
});
export type VivaQuestionsResult = z.infer<typeof vivaQuestionsSchema>;

export const vivaFeedbackSchema = z.object({
  verdict: z.string(),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
  thesisSays: z.array(z.object({ passageId: z.string(), quote: z.string() })),
  followUp: z.string(),
});
export type VivaFeedbackResult = z.infer<typeof vivaFeedbackSchema>;

/**
 * The thesis text and the answer are the student's, and either could carry one of the tags this
 * request is built from. Taken out rather than escaped: none of them is prose.
 */
const OWN_TAGS =
  /<\/?(?:passage|passages|thesis|question|probing|answer|viva-questions|viva-feedback)\b[^>]*>/gi;
const clean = (text: string) => text.replace(OWN_TAGS, '').trim();
const attr = (text: string) => clean(text).replace(/"/g, '”');

const passageBlock = (p: VivaPassage) =>
  `<passage id="${p.id}" chapter="${attr(p.chapterTitle)}">\n${clean(p.text)}\n</passage>`;

const system = (name: 'viva_questions' | 'viva_feedback') => ({
  cached: `${loadPrompt('_preamble').system}\n\n${loadPrompt(name).system}`,
});

export function buildVivaQuestionsRequest(input: {
  title: string;
  passages: readonly VivaPassage[];
  userId: string;
  documentId: string;
  signal?: AbortSignal;
}): Omit<LlmRequest, 'schema'> {
  const user = [
    '<viva-questions>',
    `<thesis title="${attr(input.title)}">`,
    ...input.passages.slice(0, VIVA.maxPassages).map(passageBlock),
    '</thesis>',
    '</viva-questions>',
  ].join('\n');
  return {
    tier: VIVA.questions.tier,
    system: system('viva_questions'),
    messages: [{ role: 'user', content: user }],
    maxTokens: VIVA.questions.maxTokens,
    temperature: VIVA.questions.temperature,
    action: 'VIVA',
    userId: input.userId,
    documentId: input.documentId,
    ...(input.signal ? { signal: input.signal } : {}),
  };
}

export type VivaQuestionDraft = {
  passageId: string;
  kind: VivaKind;
  question: string;
  probing: string;
};

const words = (text: string) => text.split(/\s+/).filter(Boolean);
const cut = (text: string, max: number) => {
  const all = words(text.trim());
  return all.length <= max ? all.join(' ') : `${all.slice(0, max).join(' ')}…`;
};

/**
 * What survives of the model's questions: a known passage, a real question, no repeats, at most
 * `VIVA.maxQuestions`. `dropped` counts the ones naming a passage that was never sent.
 */
export function postProcessVivaQuestions(
  result: VivaQuestionsResult,
  passageIds: ReadonlySet<string>,
): { questions: VivaQuestionDraft[]; dropped: number } {
  const questions: VivaQuestionDraft[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const raw of result.questions) {
    const passageId = raw.passageId.trim();
    if (!passageIds.has(passageId)) {
      dropped += 1;
      continue;
    }
    const question = cut(raw.question, 60);
    if (words(question).length < 4) continue;
    const key = question
      .toLowerCase()
      // Letters of any script: a thesis in Hindi or Tamil has no a–z to compare by.
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
    if (seen.has(key)) continue;
    seen.add(key);
    const kind = raw.kind.trim().toLowerCase();
    questions.push({
      passageId,
      kind: (VIVA_KINDS as readonly string[]).includes(kind) ? (kind as VivaKind) : 'method',
      question,
      probing: cut(raw.probing, 30),
    });
    if (questions.length === VIVA.maxQuestions) break;
  }
  return { questions, dropped };
}

export function buildVivaFeedbackRequest(input: {
  question: string;
  probing: string;
  passages: readonly VivaPassage[];
  answer: string;
  userId: string;
  documentId: string;
  signal?: AbortSignal;
}): Omit<LlmRequest, 'schema'> {
  const user = [
    '<viva-feedback>',
    `<question>${clean(input.question)}</question>`,
    `<probing>${clean(input.probing)}</probing>`,
    '<passages>',
    ...input.passages.map(passageBlock),
    '</passages>',
    `<answer>\n${clean(input.answer).slice(0, VIVA.answerMaxChars)}\n</answer>`,
    '</viva-feedback>',
  ].join('\n');
  return {
    tier: VIVA.feedback.tier,
    system: system('viva_feedback'),
    messages: [{ role: 'user', content: user }],
    maxTokens: VIVA.feedback.maxTokens,
    temperature: VIVA.feedback.temperature,
    action: 'VIVA',
    userId: input.userId,
    documentId: input.documentId,
    ...(input.signal ? { signal: input.signal } : {}),
  };
}

export type VivaFeedback = {
  verdict: VivaVerdict;
  strengths: string[];
  gaps: string[];
  /** Each quotation is the thesis's own words, found in the passage named. */
  thesisSays: Array<{ passageId: string; quote: string }>;
  followUp: string;
};

export function postProcessVivaFeedback(
  result: VivaFeedbackResult,
  passages: readonly VivaPassage[],
): VivaFeedback {
  const verdict = result.verdict.trim().toLowerCase();
  const list = (items: readonly string[], max: number, maxWords: number) =>
    items
      .map((item) => cut(item, maxWords))
      .filter((item) => item.length > 0)
      .slice(0, max);
  const thesisSays: VivaFeedback['thesisSays'] = [];
  for (const said of result.thesisSays) {
    const passage = passages.find((p) => p.id === said.passageId.trim());
    const quote = passage ? verbatimQuote(said.quote, [passage]) : null;
    if (passage && quote && thesisSays.length < 2)
      thesisSays.push({ passageId: passage.id, quote });
  }
  return {
    verdict: (VIVA_VERDICTS as readonly string[]).includes(verdict)
      ? (verdict as VivaVerdict)
      : 'partial',
    strengths: list(result.strengths, 3, 30),
    gaps: list(result.gaps, 3, 35),
    thesisSays,
    followUp: cut(result.followUp, 40),
  };
}

// ---------------------------------------------------------------------------------------------
// Mock responses, so the product and its tests run without a provider
// ---------------------------------------------------------------------------------------------

const lastMessage = (req: { messages: ReadonlyArray<{ content: string }> }) =>
  req.messages.at(-1)?.content ?? '';

const passagesIn = (text: string) =>
  [...text.matchAll(/<passage id="([^"]+)"[^>]*>\n([\s\S]*?)\n<\/passage>/g)].map((m) => ({
    id: m[1] ?? '',
    text: m[2] ?? '',
  }));

export const mockVivaQuestionsResponse = {
  match: (req: { action: string; messages: ReadonlyArray<{ content: string }> }) =>
    req.action === 'VIVA' && lastMessage(req).includes('<viva-questions>'),
  respond: (req: { messages: ReadonlyArray<{ content: string }> }): VivaQuestionsResult => ({
    questions: passagesIn(lastMessage(req))
      .slice(0, VIVA.maxQuestions)
      .map((passage, i) => ({
        passageId: passage.id,
        kind: VIVA_KINDS[i % VIVA_KINDS.length] as string,
        question: `How would you defend this to an examiner: “${words(passage.text).slice(0, 8).join(' ')}…”? (mock)`,
        probing: 'Whether the claim rests on the evidence the chapter gives (mock).',
      })),
  }),
};

export const mockVivaFeedbackResponse = {
  match: (req: { action: string; messages: ReadonlyArray<{ content: string }> }) =>
    req.action === 'VIVA' && lastMessage(req).includes('<viva-feedback>'),
  respond: (req: { messages: ReadonlyArray<{ content: string }> }): VivaFeedbackResult => {
    const text = lastMessage(req);
    const answer = /<answer>\n([\s\S]*?)\n<\/answer>/.exec(text)?.[1] ?? '';
    const count = words(answer).length;
    const first = passagesIn(text)[0];
    return {
      verdict: count > 40 ? 'strong' : count > 15 ? 'partial' : 'weak',
      strengths: count > 15 ? ['Answers the question directly (mock).'] : [],
      gaps: ['Tie the answer to the evidence your chapter gives (mock).'],
      thesisSays: first
        ? [{ passageId: first.id, quote: words(first.text).slice(0, 8).join(' ') }]
        : [],
      followUp: 'What would you do differently if you started again? (mock)',
    };
  },
};
