/**
 * Deep research in chat — ADR-0080 (2026-10-05).
 *
 * The side-by-side and same-topic studies left one place where Jenni was clearly ahead: a
 * question asked of the library came back in two minutes with seventeen sources, figures and
 * advice, where ours answered in fourteen seconds from one retrieval. ADR-0074 made ordinary chat
 * search when the library is thin; this is the slower mode a student asks for by name. One
 * `RESEARCH` unit pays for two strong-tier calls: a planner (A.4.1, `research_plan.md`) that
 * breaks the question into parts, each with a search query, and the answer (A.4.2,
 * `chat_deep.md`), written part by part from the library's best passages for every part and the
 * abstracts the searches found. The API does the searching; this file is the two requests, the
 * plan's cleaning, and the limits.
 *
 * Grounding is A.4's: `postProcessChat` whitelists exactly the passages sent.
 */

import { z } from 'zod';
import { loadPrompt } from '../prompts.js';
import type { LlmRequest, Message } from '../types.js';
import { activeFilters, CHAT, type ChatBuildInput, historyText } from './chat.js';
import type { ScopeForQueries } from './queries.js';

export const DEEP_RESEARCH = {
  planner: { tier: 'strong', maxTokens: 600, temperature: 0.3, maxParts: 5 },
  /** The answer's own budget (the adapter adds reasoning headroom). ~900 words with markers. */
  answer: { tier: 'strong', maxTokens: 2_200, temperature: 0.3 },
  /** The library's passages in the request, over every part: two of A.4's requests. */
  libraryTopK: 16,
  /** No paper holds more than this many of them while another paper has candidates. */
  perSourceCap: 4,
  /** Abstracts embedded over all the parts' searches, at most: bounds one question's embedding. */
  maxCandidates: 60,
  /** Found abstracts in the request, at most: twice ADR-0074's. */
  maxAbstracts: 12,
  /** Passages in the request, at most: `libraryTopK` + `maxAbstracts`. */
  maxPassages: 28,
  /** No model call without a time limit (the chapter build's lesson, 2026-10-01). */
  plannerTimeoutMs: 30_000,
  answerTimeoutMs: 150_000,
} as const;

export const researchPlanSchema = z.object({
  parts: z
    .array(
      z.object({
        title: z.string().trim().min(2).max(80),
        question: z.string().trim().min(8).max(300),
        query: z.string().trim().min(3).max(200),
      }),
    )
    .min(1)
    .max(8),
});
export type ResearchPlanResult = z.infer<typeof researchPlanSchema>;
export type DeepPart = ResearchPlanResult['parts'][number];

export type DeepPlanInput = {
  scope: ScopeForQueries;
  question: string;
  userId: string;
  documentId: string;
  signal?: AbortSignal;
};

export function researchPlanUserMessage(input: DeepPlanInput): string {
  const scope = input.scope;
  return [
    '<thesis>',
    `Working title: ${scope.workingTitle}`,
    `Problem statement: ${scope.problemStatement}`,
    'Objectives:',
    ...scope.objectives.map((o) => `- ${o}`),
    '</thesis>',
    `<question>${input.question}</question>`,
  ].join('\n');
}

/** A.4.1: the plan, a structured call metered and logged as `RESEARCH`. */
export function buildResearchPlanRequest(input: DeepPlanInput): Omit<LlmRequest, 'schema'> {
  return {
    tier: DEEP_RESEARCH.planner.tier,
    system: {
      cached: `${loadPrompt('_preamble').system}\n\n${loadPrompt('research_plan').system}`,
    },
    messages: [{ role: 'user', content: researchPlanUserMessage(input) }],
    maxTokens: DEEP_RESEARCH.planner.maxTokens,
    temperature: DEEP_RESEARCH.planner.temperature,
    action: 'RESEARCH',
    userId: input.userId,
    documentId: input.documentId,
    ...(input.signal ? { signal: input.signal } : {}),
  };
}

/**
 * A.4.1's rules, checked in code: a query is keyword style (no quotation or question marks),
 * 3–12 words, not repeated; at most `maxParts` parts. An empty result means the API plans in
 * code instead (`planResearchQueries`); the question is never failed for a bad plan.
 */
export function cleanResearchPlan(result: ResearchPlanResult): DeepPart[] {
  const seen = new Set<string>();
  const parts: DeepPart[] = [];
  for (const part of result.parts) {
    const query = part.query
      .replace(/["“”?]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const words = query.split(' ').filter(Boolean);
    if (words.length < 3 || words.length > 12) continue;
    const key = query.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const title = part.title
      .replace(/\s+/g, ' ')
      .replace(/[.:]+$/, '')
      .trim();
    const question = part.question.replace(/\s+/g, ' ').trim();
    if (!title || !question) continue;
    parts.push({ title, question, query });
    if (parts.length === DEEP_RESEARCH.planner.maxParts) break;
  }
  return parts;
}

export type DeepChatBuildInput = ChatBuildInput & { plan: readonly DeepPart[] };

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

export function deepChatUserMessage(input: DeepChatBuildInput): string {
  const passages = input.passages
    .slice(0, input.maxPassages ?? DEEP_RESEARCH.maxPassages)
    .map(
      (p) =>
        `<passage id="${p.id}" source="${p.shortRef}"${p.page ? ` page="${p.page}"` : ''}${
          p.origin === 'search' ? ' origin="search"' : ''
        }>\n${p.text}\n</passage>`,
    )
    .join('\n');
  const plan = input.plan
    .map((part) => `<part title="${escapeAttr(part.title)}">${part.question}</part>`)
    .join('\n');
  return [
    `<filters>${JSON.stringify(activeFilters(input.filters))}</filters>`,
    `<plan>\n${plan}\n</plan>`,
    `<passages>\n${passages}\n</passages>`,
    `<question>${input.question}</question>`,
  ].join('\n');
}

/** A.4.2: the answer, streamed, metered and logged as `RESEARCH`. */
export function buildDeepChatRequest(input: DeepChatBuildInput): LlmRequest {
  const history: Message[] = input.history
    .slice(-CHAT.keepTurns * 2)
    .map((t) => ({ role: t.role, content: historyText(t).slice(0, CHAT.maxMessageChars) }));
  return {
    tier: DEEP_RESEARCH.answer.tier,
    system: {
      cached: `${loadPrompt('_preamble').system}\n\n${input.memoryBlock}\n\n${loadPrompt('chat_deep').system}`,
    },
    messages: [
      ...history,
      {
        role: 'user',
        content: deepChatUserMessage(input),
        ...(input.images?.length ? { images: input.images } : {}),
      },
    ],
    maxTokens: DEEP_RESEARCH.answer.maxTokens,
    temperature: DEEP_RESEARCH.answer.temperature,
    action: 'RESEARCH',
    userId: input.userId,
    documentId: input.documentId,
    ...(input.signal ? { signal: input.signal } : {}),
  };
}

const STOP = new Set(
  (
    'the a an of in on for to and or with from by at as is are was were be been what which who ' +
    'how why when where does do did according sources source my our their this that these those ' +
    'main key major about into than then there here it its'
  ).split(' '),
);

/** A plan built only from the question's own words; the mock never invents a subject. */
export const mockResearchPlanResponse = {
  match: (req: { action: string; messages: ReadonlyArray<{ content: string }> }) =>
    req.action === 'RESEARCH' &&
    (req.messages.at(-1)?.content ?? '').includes('<thesis>') &&
    !(req.messages.at(-1)?.content ?? '').includes('<passages>'),
  respond: (req: { messages: ReadonlyArray<{ content: string }> }): ResearchPlanResult => {
    const content = req.messages.at(-1)?.content ?? '';
    const question = (/<question>([\s\S]*?)<\/question>/.exec(content)?.[1] ?? '').trim();
    const words = question
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOP.has(w));
    const base = words.slice(0, 4);
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    const mk = (title: string, extra: string[]) => ({
      title,
      question: `What do the studies report on ${title.toLowerCase()} for ${base.join(' ')}?`,
      query: [...base, ...extra].slice(0, 8).join(' '),
    });
    return {
      parts: [
        mk(`${cap(base[0] ?? 'Findings')} overview`, ['review']),
        mk('Causes and mechanisms', ['causes', 'determinants']),
        mk('Evidence and methods', ['survey', 'evidence']),
      ],
    };
  },
};
