/**
 * Path A proposal conversation — PRD FR-1.5, Appendix A.6, PHASES 6.1.
 *
 * The prompt file is the whole contract: one question per turn, at most three questions, then a
 * `<skeleton>` block and nothing else. What lives here is the part A.6 leaves to code:
 *
 *   - the message history is the state (A.6: "the conversation state is the message history");
 *   - `<gap_check>` is injected by code before the model's second turn;
 *   - "never ask more than three questions in total" is enforced here, not trusted: when the
 *     model asks a fourth, the caller sends it the skeleton instruction instead of the student.
 *
 * Nothing in this file writes prose. It builds requests and reads replies.
 */

import { z } from 'zod';
import { loadPrompt } from '../prompts.js';
import type { LlmRequest, Message } from '../types.js';

/** A.6's parameters. */
export const PROPOSAL = {
  tier: 'strong',
  maxTokens: 700,
  temperature: 0.5,
  /** A.6 rule 2: "Never ask more than three questions in total across the conversation." */
  maxQuestions: 3,
  /** FR-1.5: "2–4 turn guided conversation". The fourth model turn must be the skeleton. */
  maxModelTurns: 4,
  /** "up to 8 OpenAlex results" in <gap_check>. */
  gapCheckWorks: 8,
  /** FR-1.5 AC: "closest 5" shown to the student. */
  gapCheckShown: 5,
} as const;

export const skeletonSchema = z.object({
  workingTitle: z.string().trim().min(1).max(300),
  problemStatement: z.string().trim().min(1).max(4_000),
  objectives: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
  whyOpen: z.string().trim().max(2_000).default(''),
});
export type ProposalSkeleton = z.infer<typeof skeletonSchema>;

export type GapCheckWork = { title: string; year: number | null; abstract: string };
export type GapCheckInput = {
  count: number;
  works: readonly GapCheckWork[];
  /** True when the search could not run (timeout, OpenAlex down): nothing is known, not "none". */
  failed?: boolean;
};

export type ProposalTurn = { role: 'user' | 'assistant'; text: string };

export type ProposalBuildInput = {
  history: readonly ProposalTurn[];
  gapCheck?: GapCheckInput | null;
  /** A.6 `<constraints>`: word count, department, deadline, guide's interests — when known. */
  constraints?: string | null;
  userId: string;
  documentId: string;
  signal?: AbortSignal;
};

/** The one instruction code may send in the student's place (PHASES 6.1). */
export const SKELETON_INSTRUCTION =
  'You have asked three questions. Do not ask another. Output the proposal skeleton now, in the exact <skeleton> form, and nothing else.';

/**
 * Said inside an empty `<gap_check>`, because an empty block was not enough: with 0 works found
 * the model still wrote "Related work found addresses …" (docs/JENNI-FIX-LIST.md item 3). Code
 * states the fact; the prompt file is unchanged.
 */
export const GAP_CHECK_NONE =
  'The related-work search found no related works. No related work may be described as found.';
export const GAP_CHECK_FAILED =
  'The related-work search could not run, so nothing is known about related work. No related work may be described as found.';

/** A.6: "- {{title}} ({{year}}) — {{one_line_abstract}}" plus the total count. */
export function renderGapCheck(gap: GapCheckInput): string {
  if (gap.failed) {
    return ['<gap_check total="unknown">', GAP_CHECK_FAILED, '</gap_check>'].join('\n');
  }
  if (gap.count === 0 || gap.works.length === 0) {
    return [`<gap_check total="${gap.count}">`, GAP_CHECK_NONE, '</gap_check>'].join('\n');
  }
  const lines = gap.works
    .slice(0, PROPOSAL.gapCheckWorks)
    .map((w) => `- ${w.title} (${w.year ?? 'n.d.'}) — ${w.abstract || 'no abstract available'}`);
  return [`<gap_check total="${gap.count}">`, ...lines, '</gap_check>'].join('\n');
}

export function buildProposalRequest(input: ProposalBuildInput): LlmRequest {
  const system = `${loadPrompt('_preamble').system}\n\n${loadPrompt('proposal').system}`;
  const volatile: string[] = [];
  if (input.constraints?.trim()) {
    volatile.push(`<constraints>\n${input.constraints.trim()}\n</constraints>`);
  }
  // "Code injects, before the model's second turn": once the student has answered the first
  // question, every later turn sees the same gap check.
  if (input.gapCheck && input.history.filter((t) => t.role === 'assistant').length >= 1) {
    volatile.push(renderGapCheck(input.gapCheck));
  }
  const messages: Message[] = input.history.map((t) => ({ role: t.role, content: t.text }));
  return {
    tier: PROPOSAL.tier,
    system: { cached: system, ...(volatile.length ? { volatile: volatile.join('\n\n') } : {}) },
    messages,
    maxTokens: PROPOSAL.maxTokens,
    temperature: PROPOSAL.temperature,
    action: 'PROPOSAL',
    userId: input.userId,
    documentId: input.documentId,
    ...(input.signal ? { signal: input.signal } : {}),
  };
}

export type ProposalReply =
  | { kind: 'question'; text: string }
  | { kind: 'skeleton'; skeleton: ProposalSkeleton; text: string }
  | { kind: 'invalid'; text: string; reason: string };

const SKELETON_RE = /<skeleton>\s*([\s\S]*?)\s*<\/skeleton>/i;

/** Reads a model turn: a question to relay, a skeleton to save, or neither. */
export function parseProposalReply(text: string): ProposalReply {
  const match = SKELETON_RE.exec(text);
  if (!match?.[1]) return { kind: 'question', text: text.trim() };
  let raw: unknown;
  try {
    raw = JSON.parse(match[1]);
  } catch {
    return { kind: 'invalid', text, reason: 'skeleton is not JSON' };
  }
  const parsed = skeletonSchema.safeParse(raw);
  if (!parsed.success) {
    return { kind: 'invalid', text, reason: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  return { kind: 'skeleton', skeleton: parsed.data, text };
}

/** How many questions the model has asked so far — every assistant turn that was not a skeleton. */
export function questionsAsked(history: readonly ProposalTurn[]): number {
  return history.filter((t) => t.role === 'assistant' && !SKELETON_RE.test(t.text)).length;
}

/**
 * A.6 rule 2, enforced. True when the next model turn may still be a question; false when the
 * caller must force the skeleton instead (PHASES 6.1: "if the model asks a fourth, the server
 * replies with the skeleton instruction").
 */
export function mayAskAnotherQuestion(history: readonly ProposalTurn[]): boolean {
  return questionsAsked(history) < PROPOSAL.maxQuestions;
}

/**
 * An answer that only picks an option — "2", "b", "(3)", "2." — and says nothing about the topic.
 * Searched for, it is noise; the question it answers is not part of the search.
 */
const OPTION_PICK = /^\(?\s*(?:\d{1,2}|[a-f])\s*[.)]?$/i;

/** The student's own words so far, for the gap-check query (the "clarified topic"). */
export function clarifiedTopic(history: readonly ProposalTurn[]): string {
  return history
    .filter((t) => t.role === 'user')
    .map((t) => t.text.trim())
    .filter((text) => text.length > 0 && !OPTION_PICK.test(text))
    .join(' ')
    .slice(0, 400);
}

// ---------------------------------------------------------------------------------------------
// Mock (AI_PROVIDER=mock)
// ---------------------------------------------------------------------------------------------

/** Only the mock knows this; it keeps asking questions so a test can watch the fourth be blocked. */
export const MOCK_KEEP_ASKING = '[[mock:keep-asking]]';

const MOCK_QUESTIONS = [
  'Is this mainly about (a) policy, (b) technology adoption, (c) economic impact, or something else?',
  'Which setting: (a) one district, (b) one state, (c) a national comparison, or something else?',
  'What kind of evidence do you expect to use: (a) a survey you run, (b) existing datasets, (c) interviews, or something else?',
];

/**
 * An A.6-shaped answer built from the conversation itself: a narrowing question while fewer than
 * three have been asked, then a skeleton whose every field is the student's own words. It
 * invents nothing, so the proposal screen it lands on is honest about its source.
 */
export function mockProposalFor(req: {
  messages: ReadonlyArray<{ role: string; content: string }>;
}): string {
  const history: ProposalTurn[] = req.messages.map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    text: m.content,
  }));
  const forced = history.at(-1)?.text.trim() === SKELETON_INSTRUCTION;
  const keepAsking = history.some((t) => t.role === 'user' && t.text.includes(MOCK_KEEP_ASKING));
  const asked = questionsAsked(history);
  if (!forced && (keepAsking || asked < PROPOSAL.maxQuestions)) {
    return MOCK_QUESTIONS[asked % MOCK_QUESTIONS.length] ?? 'Which aspect matters most to you?';
  }
  const said = history.filter((t) => t.role === 'user').map((t) => t.text.trim());
  const topic = said[0] ?? 'the topic';
  const skeleton: ProposalSkeleton = {
    workingTitle: topic.length > 120 ? `${topic.slice(0, 117)}…` : topic,
    problemStatement: said.slice(0, 2).join(' ') || topic,
    objectives: said
      .slice(1, 4)
      .map((s) => `Examine: ${s}`)
      .concat(['State the scope precisely.']),
    whyOpen:
      'The related work found covers adjacent settings; the specific case above is not yet answered (mock).',
  };
  return `<skeleton>\n${JSON.stringify(skeleton)}\n</skeleton>`;
}
