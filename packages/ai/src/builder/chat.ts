/**
 * Chat over the library — PRD FR-4.9, Appendix A.4, PHASES v2 W9.4.
 *
 * Fast tier, cached A.0 + A.0.1, top-8 passages after the student's filters (year range, minimum
 * citations, exclude preprints), the last four turns as prior messages, and every factual
 * statement cited with `{{cite:ID}}`. The two exact replies A.4 specifies — "your library does not
 * contain enough" and "use Assist or Draft mode" — are matched here so the UI can render them as
 * states rather than as prose.
 */

import { loadPrompt } from '../prompts.js';
import { renderTemplate } from '../template.js';
import type { LlmRequest, Message } from '../types.js';
import type { PromptPassage } from './assist.js';
import { CITE_RE } from './postprocess.js';

export const CHAT = {
  tier: 'fast',
  maxTokens: 600,
  temperature: 0.3,
  /** A.4: "<passages> (top 8)". */
  topK: 8,
  /** A.4: "the last 4 turns of the conversation as prior messages". */
  keepTurns: 4,
  maxMessageChars: 2_000,
} as const;

export type ChatFilters = {
  yearFrom?: number | null;
  yearTo?: number | null;
  minCitations?: number | null;
  excludePreprints?: boolean;
};

export type ChatTurn = { role: 'user' | 'assistant'; text: string };

export type ChatBuildInput = {
  memoryBlock: string;
  question: string;
  history: readonly ChatTurn[];
  passages: readonly PromptPassage[];
  filters: ChatFilters;
  userId: string;
  documentId: string;
  signal?: AbortSignal;
};

/** Only the filters the student actually set; an empty object reads as "no filters". */
export function activeFilters(filters: ChatFilters): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (filters.yearFrom) out.yearFrom = filters.yearFrom;
  if (filters.yearTo) out.yearTo = filters.yearTo;
  if (filters.minCitations) out.minCitations = filters.minCitations;
  if (filters.excludePreprints) out.excludePreprints = true;
  return out;
}

export function chatUserMessage(input: ChatBuildInput): string {
  const passages = input.passages
    .slice(0, CHAT.topK)
    .map(
      (p) =>
        `<passage id="${p.id}" source="${p.shortRef}"${p.page ? ` page="${p.page}"` : ''}>\n${p.text}\n</passage>`,
    )
    .join('\n');
  const template = loadPrompt('chat').user;
  const data = {
    filters_json: JSON.stringify(activeFilters(input.filters)),
    passages,
    message: input.question,
  };
  if (template) return renderTemplate(template, data);
  return [
    `<filters>${data.filters_json}</filters>`,
    `<passages>\n${passages}\n</passages>`,
    `<question>${input.question}</question>`,
  ].join('\n\n');
}

export function buildChatRequest(input: ChatBuildInput): LlmRequest {
  const history: Message[] = input.history
    .slice(-CHAT.keepTurns * 2)
    .map((t) => ({ role: t.role, content: t.text.slice(0, CHAT.maxMessageChars) }));
  return {
    tier: CHAT.tier,
    system: {
      cached: `${loadPrompt('_preamble').system}\n\n${input.memoryBlock}\n\n${loadPrompt('chat').system}`,
    },
    messages: [...history, { role: 'user', content: chatUserMessage(input) }],
    maxTokens: CHAT.maxTokens,
    temperature: CHAT.temperature,
    action: 'CHAT',
    userId: input.userId,
    documentId: input.documentId,
    ...(input.signal ? { signal: input.signal } : {}),
  };
}

export const NOT_ENOUGH_PREFIX = 'Your library does not contain enough on this.';
export const WRITING_REDIRECT_PREFIX = 'Use Assist or Draft mode in the editor for writing';

/**
 * What the student is told when the question is nowhere near their library.
 *
 * Distinct from `NOT_ENOUGH_PREFIX`, which means "a fair question about your subject that your
 * sources do not answer — go and add some". This one means "this is not a question about your
 * subject at all", and pointing that student at more sources would be nonsense.
 *
 * Written by the server, never by a model: the whole point is that no provider call was made. See
 * `isOffTopic` in `@tc/retrieval` for how that is decided, and for the measurements behind it.
 */
export const OFF_TOPIC_REPLY =
  'This chat only answers questions about the sources in your library. ' +
  'Nothing in your library relates to that, so there is nothing for me to answer from.';

/**
 * What the student is told when their own filters removed every passage.
 *
 * Separate from `OFF_TOPIC_REPLY` because the cause is the opposite and so is the fix: the library
 * does have something to say, and a control the student set is what is stopping it. Telling them
 * nothing relates to their question would send them off to find sources they already have.
 */
export const FILTERED_OUT_REPLY =
  'Your filters left nothing to answer from. Widen the year range, or turn off the preprint and ' +
  'citation filters, and ask again.';

export type ChatOutcome =
  | 'answered'
  | 'not-enough'
  | 'writing-redirect'
  | 'off-topic'
  | 'filtered-out';

export type ChatPostProcess = {
  text: string;
  outcome: ChatOutcome;
  /** Passage ids the answer cites, in order of first appearance. */
  cited: string[];
  hallucinated: string[];
};

/**
 * §10.6 for chat: a `{{cite:ID}}` that is not one of the passages sent is stripped and counted.
 * The two scripted replies are recognised so the panel can show them as a state with an action
 * (add sources / open the editor) rather than as an ordinary answer.
 */
export function postProcessChat(raw: string, allowedIds: readonly string[]): ChatPostProcess {
  const allowed = new Set(allowedIds);
  const cited: string[] = [];
  const hallucinated: string[] = [];
  const text = raw
    .replace(CITE_RE, (match, id: string) => {
      const key = id.trim();
      if (!allowed.has(key)) {
        hallucinated.push(key);
        return '';
      }
      if (!cited.includes(key)) cited.push(key);
      return match;
    })
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  const outcome: ChatOutcome = text.startsWith(NOT_ENOUGH_PREFIX)
    ? 'not-enough'
    : text.startsWith(WRITING_REDIRECT_PREFIX)
      ? 'writing-redirect'
      : 'answered';
  return { text, outcome, cited, hallucinated };
}

// ---------------------------------------------------------------------------------------------
// Mock (AI_PROVIDER=mock)
// ---------------------------------------------------------------------------------------------

const WRITING_ASK =
  /\b(write|draft|compose|rewrite|expand)\b.*\b(chapter|section|paragraph|introduction|thesis|for me)\b/i;

const STOP = new Set(
  'what how why does do is are the a an of in on for to and or with by from about my our this that there their can could would should'.split(
    ' ',
  ),
);

/**
 * Answers only from the passages it was given: the sentences that share the most words with the
 * question, each cited to its own passage. When nothing overlaps it produces A.4's exact
 * "not enough" reply with a topic taken from the question's own words, and a writing request gets
 * A.4's exact redirect. It never states a fact the passages do not contain.
 */
export function mockChatFor(req: { messages: ReadonlyArray<{ content: string }> }): string {
  const content = req.messages.at(-1)?.content ?? '';
  const question = (/<question>([\s\S]*?)<\/question>/.exec(content)?.[1] ?? '').trim();
  if (WRITING_ASK.test(question)) {
    return `${WRITING_REDIRECT_PREFIX}; here I can only answer questions about your sources.`;
  }

  const passages = [
    ...content.matchAll(/<passage id="([^"]+)"[^>]*>\n([\s\S]*?)\n<\/passage>/g),
  ].map((m) => ({ id: m[1] ?? '', text: (m[2] ?? '').trim() }));
  const keywords = question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3 && !STOP.has(w));

  const scored = passages
    .map((p) => {
      const sentences = p.text.match(/[^.!?]+[.!?]+/g) ?? [p.text];
      const best = sentences
        .map((s) => ({
          s: s.trim(),
          score: keywords.filter((k) => s.toLowerCase().includes(k)).length,
        }))
        .sort((a, b) => b.score - a.score)[0];
      return { id: p.id, sentence: best?.s ?? '', score: best?.score ?? 0 };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (scored.length === 0) {
    const topic = keywords.slice(0, 5).join(' ') || 'this topic';
    return `${NOT_ENOUGH_PREFIX} Try adding sources on: ${topic}.`;
  }
  return scored.map((x) => `${x.sentence} {{cite:${x.id}}}`).join(' ');
}
