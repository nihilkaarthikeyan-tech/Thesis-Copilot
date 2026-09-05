/**
 * Citation suggestion — PRD A.3 (`cite.md`), FR-4.5, PHASES 3.6.
 *
 *   FR-4.5: "a separate trigger (heuristic claim detector + optional model flag) offers 1–3
 *   candidate citations from the library with the supporting passage; student inserts one or
 *   dismisses. Never fires on every keystroke; at most once per sentence end."
 *
 * The heuristic is the gate in front of a metered call: it decides whether a sentence is the kind
 * that needs a source at all. It is deliberately narrow. A false positive spends one of the
 * student's 10–30 monthly CITE units and interrupts them; a false negative costs nothing, because
 * they can still ask for a citation by hand.
 */

import { z } from 'zod';
import { loadPrompt } from '../prompts.js';
import { renderTemplate } from '../template.js';
import type { LlmRequest } from '../types.js';
import type { PromptPassage } from './assist.js';

/** A.3's parameters. */
export const CITE = {
  tier: 'fast',
  maxTokens: 200,
  temperature: 0,
  /** §10.4 top_k for a citation suggestion. */
  topK: 6,
  /** FR-4.5: "offers 1–3 candidate citations". */
  maxCandidates: 3,
} as const;

// ---------------------------------------------------------------------------------------------
// The claim heuristic (FR-4.5)
// ---------------------------------------------------------------------------------------------

/** Why a sentence was judged to need a source. Shown in the log, not to the student. */
export type ClaimReason = 'figure' | 'attribution' | 'comparative';

export type ClaimVerdict = { isClaim: boolean; reasons: ClaimReason[] };

/**
 * A number that is doing evidential work: a percentage, a count, a year range, a p-value.
 * Bare small integers are excluded, because "three districts" and "two reasons" are not claims
 * about prior work, and a chapter is full of them.
 */
const FIGURE = [
  /\b\d+(?:\.\d+)?\s?%/, // 78%, 4.5 %
  /\bp\s?[<=>]\s?0?\.\d+/i, // p < 0.05
  /\b\d{1,3}(?:,\d{3})+\b/, // 1,200
  /\b\d+(?:\.\d+)?\s?(?:million|billion|thousand|crore|lakh)\b/i,
  /\b(?:19|20)\d{2}\s?[–-]\s?(?:19|20)?\d{2}\b/, // 2011–2019
  /\b\d{3,}\b/, // 312 households
];

/**
 * Phrases that attribute a finding to someone else. These are the strongest signal: a sentence
 * that says "studies show" and carries no citation is exactly what a supervisor circles.
 */
const ATTRIBUTION = [
  /\bstudies\s+(?:show|suggest|indicate|find|found|report)\b/i,
  /\bresearch\s+(?:shows|suggests|indicates|finds|found)\b/i,
  /\bhas\s+been\s+(?:shown|demonstrated|found|reported|observed|argued|established)\b/i,
  /\b(?:it\s+is|it\s+has\s+been)\s+(?:widely\s+)?(?:accepted|argued|reported|recognised|recognized)\b/i,
  /\baccording\s+to\b/i,
  /\bevidence\s+(?:shows|suggests|indicates)\b/i,
  /\bprior\s+(?:work|studies|research)\b/i,
  /\bprevious\s+(?:work|studies|research)\b/i,
  /\bthe\s+literature\b/i,
  /\bare\s+(?:known|reported|estimated)\s+to\b/i,
  /\bsignificantly\b/i,
];

/** Comparative and causal claims: "higher than", "more likely to", "leads to". */
const COMPARATIVE = [
  /\b(?:higher|lower|greater|larger|smaller|faster|slower|better|worse|more|less)\s+than\b/i,
  /\b(?:more|less)\s+likely\s+to\b/i,
  /\b(?:increases?|decreases?|reduces?|improves?|worsens?)\s+(?:the\s+)?\w+\s+by\b/i,
  /\b(?:leads?|contributes?|gives?\s+rise)\s+to\b/i,
  /\bcorrelat(?:es?|ed|ion)\s+with\b/i,
  /\bassociated\s+with\b/i,
  /\b(?:causes?|caused)\b/i,
  /\bcompared\s+(?:to|with)\b/i,
  /\bthe\s+(?:main|leading|primary|dominant|largest)\s+\w+/i,
];

/** Words that mark a sentence as the student's own move, not a claim about the world. */
const STRUCTURAL =
  /\b(?:this\s+(?:section|chapter|thesis|study|paper)|the\s+(?:following|next|remainder)|i\s+(?:will|argue)|we\s+(?:will|argue)|section\s+\d)\b/i;

/**
 * Whether a finished sentence makes a claim that wants a source.
 *
 * Structural sentences are excluded outright: "This section examines cost barriers" states nothing
 * about prior work, and A.1 explicitly tells the model to write such sentences when it has no
 * passage to cite. Suggesting a citation for one would be nonsense.
 */
export function detectClaim(sentence: string): ClaimVerdict {
  const text = sentence.trim();
  // Too short to be a claim, and a fragment mid-typing is not a sentence yet.
  if (text.split(/\s+/).length < 5) return { isClaim: false, reasons: [] };
  if (STRUCTURAL.test(text)) return { isClaim: false, reasons: [] };

  const reasons: ClaimReason[] = [];
  if (FIGURE.some((re) => re.test(text))) reasons.push('figure');
  if (ATTRIBUTION.some((re) => re.test(text))) reasons.push('attribution');
  if (COMPARATIVE.some((re) => re.test(text))) reasons.push('comparative');

  return { isClaim: reasons.length > 0, reasons };
}

/** True when the text ends on a sentence terminator, which is the only moment FR-4.5 allows. */
export function endsSentence(before: string): boolean {
  return /[.!?]["')\]]?\s*$/.test(before);
}

/** The finished sentence immediately before the cursor, or null when there is not one yet. */
export function lastCompleteSentence(before: string): string | null {
  if (!endsSentence(before)) return null;
  const trimmed = before.trimEnd();
  // Walk back to the previous terminator that is followed by a space, which starts this sentence.
  const match = /(?:^|[.!?]["')\]]?\s+)([^.!?]*[.!?]["')\]]?)\s*$/.exec(trimmed);
  const sentence = match?.[1]?.trim() ?? trimmed;
  return sentence.length > 0 ? sentence : null;
}

// ---------------------------------------------------------------------------------------------
// The A.3 request
// ---------------------------------------------------------------------------------------------

export const citeSupport = z.enum(['direct', 'partial', 'none']);

export const citeCandidateSchema = z.object({
  id: z.string().trim().min(1),
  support: citeSupport,
  why: z.string().trim().default(''),
});

/** A.3's structured output. */
export const citeResultSchema = z.object({
  candidates: z.array(citeCandidateSchema).default([]),
});

export type CiteCandidate = z.infer<typeof citeCandidateSchema>;
export type CiteResult = z.infer<typeof citeResultSchema>;

export type CiteBuildInput = {
  memoryBlock: string;
  sentence: string;
  passages: readonly PromptPassage[];
  userId: string;
  documentId: string;
  signal?: AbortSignal;
};

/** A.3's user message: the sentence, then the same `<passages>` block A.1 uses. */
export function citeUserMessage(sentence: string, passages: readonly PromptPassage[]): string {
  const lines = passages.map(
    (p) =>
      `<passage id="${p.id}" source="${p.shortRef}" page="${p.page ?? ''}">${p.text}</passage>`,
  );
  return `<sentence>${sentence.trim()}</sentence>\n<passages>\n${lines.join('\n')}\n</passages>`;
}

export function buildCiteRequest(input: CiteBuildInput): LlmRequest {
  const preamble = loadPrompt('_preamble').system.trim();
  const task = loadPrompt('cite').system.trim();

  return {
    tier: CITE.tier,
    // Same cached prefix as Assist, so a CITE call reuses the block Assist already warmed (§10.3).
    system: { cached: [preamble, input.memoryBlock.trim(), task].join('\n\n') },
    messages: [{ role: 'user', content: citeUserMessage(input.sentence, input.passages) }],
    maxTokens: CITE.maxTokens,
    temperature: CITE.temperature,
    action: 'CITE',
    userId: input.userId,
    documentId: input.documentId,
    ...(input.signal ? { signal: input.signal } : {}),
  };
}

/**
 * A.3: "Code shows only `direct` and `partial` candidates, ordered direct first, max 3."
 *
 * Ids the model invented are dropped here for the same reason §10.6 strips them from Assist
 * output: a candidate that points at no passage cannot be inserted, and offering it would be
 * offering a citation to nothing.
 */
export function usableCandidates(
  result: CiteResult,
  passageIds: readonly string[],
): { candidates: CiteCandidate[]; hallucinated: string[] } {
  const allowed = new Set(passageIds);
  const hallucinated: string[] = [];
  const kept: CiteCandidate[] = [];
  const seen = new Set<string>();

  for (const candidate of result.candidates) {
    if (!allowed.has(candidate.id)) {
      hallucinated.push(candidate.id);
      continue;
    }
    if (candidate.support === 'none' || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    kept.push(candidate);
  }

  const rank = (support: CiteCandidate['support']) => (support === 'direct' ? 0 : 1);
  kept.sort((a, b) => rank(a.support) - rank(b.support));
  return { candidates: kept.slice(0, CITE.maxCandidates), hallucinated };
}

/** Renders the model's structured answer for the mock provider, so tests exercise the real shape. */
export function mockCiteResponse(req: LlmRequest): CiteResult {
  const user = req.messages.find((m) => m.role === 'user')?.content ?? '';
  const ids = [...user.matchAll(/<passage id="([^"]+)"/g)].map((m) => m[1] as string);
  return {
    candidates: ids.map((id, index) => ({
      id,
      support: index === 0 ? 'direct' : index === 1 ? 'partial' : 'none',
      why: index < 2 ? 'The passage reports the figure the sentence states.' : 'Unrelated.',
    })),
  };
}
