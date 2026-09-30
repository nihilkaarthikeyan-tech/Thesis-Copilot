/**
 * Coherence prompts — PRD §5.6, Appendix A.12, D.1.2, PHASES v2 B1.4–B1.7.
 *
 * Four prompts, one file, because they share their shape: Strong tier (except A.12.3), temperature
 * 0, structured output, not cached — a coherence run reads a different slice of the thesis every
 * time, so there is no block worth caching.
 *
 * Everything the model is asked to judge is quoted to it by id, and every id maps back to a
 * ProseMirror range here. A flag whose id the model invented is dropped rather than shown: the
 * same rule §10.6 applies to citations, for the same reason.
 */

import { z } from 'zod';
import { loadPrompt } from '../prompts.js';
import type { LlmRequest } from '../types.js';

export const COHERENCE = {
  /** D.1.2: at most 12 terms a run, by frequency. */
  maxTerms: 12,
  /** A.12.1: "≤ 40 sentences". */
  maxSentencesPerTerm: 40,
  /** A.12.2 step 1: "up to 25 checkable claims". */
  maxClaims: 25,
  /** D.1.1's reduced scope when the estimate is over budget. */
  reducedMaxClaims: 15,
  /** D.1.2: top 5 chunks from other chapters, per claim. */
  neighboursPerClaim: 5,
  /** A.12.3: "Batch ≤ 40 sentences per call". */
  unsupportedBatch: 40,
  /**
   * ADR-0023: cited sentences per support-check call. Ten, not forty: each carries up to two
   * passages of ~350 tokens, and a Fast call reading 7,000 tokens stays accurate.
   */
  supportBatch: 10,
  /** ADR-0023: cited sentences checked per run, across all changed chapters; the rest wait. */
  maxSupportChecks: 60,
  /** ADR-0023: passages read per cited source — its own passage, or the two nearest the sentence. */
  passagesPerCitation: 2,
  /** D.1.1's budget guard, in rupees. */
  budgetInr: 12,
  summaryWords: 150,
} as const;

const strong = { tier: 'strong', temperature: 0 } as const;

function request(
  prompt: 'coh_term' | 'coh_claim' | 'coh_unsupported' | 'coh_outline' | 'coh_support',
  user: string,
  opts: {
    tier?: 'fast' | 'strong';
    maxTokens: number;
    userId: string;
    documentId: string;
    signal?: AbortSignal;
  },
): Omit<LlmRequest, 'schema'> {
  return {
    tier: opts.tier ?? strong.tier,
    system: { cached: `${loadPrompt('_preamble').system}\n\n${loadPrompt(prompt).system}` },
    messages: [{ role: 'user', content: user }],
    maxTokens: opts.maxTokens,
    temperature: strong.temperature,
    action: 'COHERENCE',
    userId: opts.userId,
    documentId: opts.documentId,
    ...(opts.signal ? { signal: opts.signal } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// A.12.1 TERM_DRIFT
// ---------------------------------------------------------------------------------------------

export const termDriftSchema = z.object({
  flags: z
    .array(
      z.object({
        sentenceId: z.string(),
        kind: z.enum(['conflict', 'drift']),
        explanation: z.string().max(400),
      }),
    )
    .default([]),
});
export type TermDriftResult = z.infer<typeof termDriftSchema>;

export type TermSentence = { id: string; chapter: string; sentence: string };

export function termDriftUserMessage(
  term: string,
  definition: string,
  sentences: readonly TermSentence[],
): string {
  const lines = sentences
    .slice(0, COHERENCE.maxSentencesPerTerm)
    .map((s) => `- ${s.id} | ${s.chapter} | ${s.sentence}`);
  return [
    `<term>${term}</term>`,
    `<definition>${definition}</definition>`,
    '<sentences>',
    ...lines,
    '</sentences>',
  ].join('\n');
}

export function buildTermDriftRequest(input: {
  term: string;
  definition: string;
  sentences: readonly TermSentence[];
  userId: string;
  documentId: string;
  signal?: AbortSignal;
}): Omit<LlmRequest, 'schema'> {
  return request('coh_term', termDriftUserMessage(input.term, input.definition, input.sentences), {
    maxTokens: 1_000,
    ...input,
  });
}

// ---------------------------------------------------------------------------------------------
// A.12.2 CLAIM_CONTRADICTION (two steps)
// ---------------------------------------------------------------------------------------------

export const claimsSchema = z.object({
  claims: z
    .array(
      z.object({
        id: z.string(),
        text: z.string(),
        // A.12.2 asks the model for `"span":[from,to]`, and that is what this accepts — but as a
        // number array, not a `z.tuple`. A tuple compiles to JSON Schema `prefixItems`, which
        // OpenAI's `response_format` rejects outright ("[{'type': 'number'}, {'type': 'number'}]
        // is not of type 'object', 'boolean'"), taking the whole claim-extraction call with it.
        // Nothing reads `span`, so nothing depends on the pair-ness the tuple was buying.
        span: z.array(z.number()).optional(),
      }),
    )
    .default([]),
});
export type ClaimsResult = z.infer<typeof claimsSchema>;

export const contradictionSchema = z.object({
  flags: z
    .array(
      z.object({
        claimId: z.string(),
        passageId: z.string(),
        severity: z.enum(['ERROR', 'WARN']),
        explanation: z.string().max(500),
      }),
    )
    .default([]),
});
export type ContradictionResult = z.infer<typeof contradictionSchema>;

/** Step 1: the chapter's own text, with the positions the model is asked to span. */
export function buildClaimsRequest(input: {
  chapterTitle: string;
  chapterText: string;
  maxClaims?: number;
  userId: string;
  documentId: string;
  signal?: AbortSignal;
}): Omit<LlmRequest, 'schema'> {
  const user = [
    `<chapter title="${input.chapterTitle.replace(/"/g, "'")}">`,
    input.chapterText,
    '</chapter>',
    `Extract at most ${input.maxClaims ?? COHERENCE.maxClaims} claims.`,
  ].join('\n');
  return request('coh_claim', user, { maxTokens: 2_000, ...input });
}

export type ClaimWithPassages = {
  id: string;
  text: string;
  passages: ReadonlyArray<{ id: string; chapter: string; text: string }>;
};

/** Step 2: every claim with the passages retrieved for it, in one call per chapter (D.1.2). */
export function buildContradictionRequest(input: {
  claims: readonly ClaimWithPassages[];
  userId: string;
  documentId: string;
  signal?: AbortSignal;
}): Omit<LlmRequest, 'schema'> {
  const blocks = input.claims.map((claim) =>
    [
      `<claim id="${claim.id}">${claim.text}</claim>`,
      ...claim.passages.map(
        (p) => `  <passage id="${p.id}" chapter="${p.chapter}">${p.text}</passage>`,
      ),
    ].join('\n'),
  );
  return request('coh_claim', `<comparison>\n${blocks.join('\n')}\n</comparison>`, {
    maxTokens: 2_000,
    ...input,
  });
}

// ---------------------------------------------------------------------------------------------
// A.12.3 UNSUPPORTED_CLAIM (Fast tier)
// ---------------------------------------------------------------------------------------------

export const unsupportedSchema = z.object({
  results: z
    .array(
      z.object({
        sentenceId: z.string(),
        needsSupport: z.boolean(),
        why: z.string().max(200).default(''),
      }),
    )
    .default([]),
});
export type UnsupportedResult = z.infer<typeof unsupportedSchema>;

/**
 * D.1.2's heuristic pre-filter, run before any call: a sentence with a figure, an attribution
 * phrase, or a causal/comparative claim, and no citation node inside it. Everything else never
 * reaches the model, which is what keeps this check inside its two-calls-per-chapter budget.
 */
const NEEDS_SUPPORT_PATTERNS: readonly RegExp[] = [
  /\b\d+(?:\.\d+)?\s?%/,
  /\b\d{3,}\b/,
  /\bp\s?[<=>]\s?0?\.\d+/i,
  /\bstudies\s+(?:show|suggest|indicate|find|found|report)\b/i,
  /\bresearch\s+(?:shows|suggests|indicates|finds|found)\b/i,
  /\bit\s+is\s+(?:well\s+)?(?:known|established|accepted|recognised|recognized)\b/i,
  /\bhas\s+been\s+(?:shown|demonstrated|found|reported|observed|argued)\b/i,
  /\bsignificantly\b/i,
  /\b(?:higher|lower|greater|larger|smaller|faster|slower|better|worse)\s+than\b/i,
  /\b(?:causes?|caused|leads?\s+to|results?\s+in|contributes?\s+to)\b/i,
  /\baccording\s+to\b/i,
  /\bprior\s+(?:work|studies|research)\b/i,
];

export function mightNeedSupport(sentence: { text: string; hasCitation: boolean }): boolean {
  if (sentence.hasCitation) return false;
  if (sentence.text.length < 40) return false;
  return NEEDS_SUPPORT_PATTERNS.some((re) => re.test(sentence.text));
}

export function buildUnsupportedRequest(input: {
  sentences: ReadonlyArray<{ id: string; text: string }>;
  chapterRole: string;
  userId: string;
  documentId: string;
  signal?: AbortSignal;
}): Omit<LlmRequest, 'schema'> {
  const user = [
    `<chapter_role>${input.chapterRole}</chapter_role>`,
    '<sentences>',
    ...input.sentences.slice(0, COHERENCE.unsupportedBatch).map((s) => `- ${s.id} | ${s.text}`),
    '</sentences>',
  ].join('\n');
  return request('coh_unsupported', user, { tier: 'fast', maxTokens: 1_500, ...input });
}

// ---------------------------------------------------------------------------------------------
// Citation support — ADR-0023, the one coherence prompt not from Appendix A
// ---------------------------------------------------------------------------------------------

export const SUPPORT_VERDICTS = [
  'SUPPORTED',
  'WEAKLY_SUPPORTED',
  'OVERSTATED',
  'MISREPRESENTED',
  // 2026-09-30, approved by the owner: a finding about another material or setting applied to
  // the thesis's own (a reviewer caught Jenni citing stainless steel for maraging steel).
  'DIFFERENT_SUBJECT',
  'NOT_IN_PASSAGE',
] as const;
export type SupportVerdict = (typeof SUPPORT_VERDICTS)[number];

/**
 * Strict-mode compatible — no defaults, no length limits — so OpenAI holds `verdict` to the list.
 * With defaults the call falls back to JSON mode, where nothing holds an enum, and one invented
 * verdict would fail the whole batch of ten (ADR-0026 measured exactly that for proofreading).
 * Lengths are enforced where the text is used: `supportFlagText` bounds the reason, and a quote
 * is kept only if it is the passage's own words.
 */
export const supportSchema = z.object({
  results: z.array(
    z.object({
      sentenceId: z.string(),
      verdict: z.enum(SUPPORT_VERDICTS),
      why: z.string(),
      quote: z.string(),
    }),
  ),
});
export type SupportResult = z.infer<typeof supportSchema>;

/** One cited sentence and the passages its citations point at. */
export type SupportItem = {
  sentenceId: string;
  sentence: string;
  passages: ReadonlyArray<{ shortRef: string; page?: number | null; text: string }>;
};

export function buildSupportRequest(input: {
  items: readonly SupportItem[];
  userId: string;
  documentId: string;
  signal?: AbortSignal;
}): Omit<LlmRequest, 'schema'> {
  const blocks = input.items
    .slice(0, COHERENCE.supportBatch)
    .map((item) =>
      [
        `<sentence id="${item.sentenceId}">${item.sentence}</sentence>`,
        ...item.passages.map(
          (p) =>
            `<passage for="${item.sentenceId}" source="${p.shortRef}"${p.page ? ` page="${p.page}"` : ''}>${p.text}</passage>`,
        ),
      ].join('\n'),
    );
  // Strong since 2026-09-30 (ADR-0023 addendum). On the real models, only gpt-5-mini used the
  // DIFFERENT_SUBJECT verdict for a stainless-steel finding cited for maraging steel, and passed
  // the control sentence that said so openly; gpt-5-nano saw the difference and labelled both
  // NOT_IN_PASSAGE. About ₹1.2 more a month for a student on one coherence run.
  return request('coh_support', `<support_check>\n${blocks.join('\n\n')}\n</support_check>`, {
    tier: 'strong',
    maxTokens: 1_500,
    ...input,
  });
}

/**
 * The model's quote, if it really is in one of the passages, word for word.
 *
 * A verdict shown to a student as "the source says '…'" must be the source's words. A model asked
 * to quote will sometimes paraphrase and wrap the paraphrase in quotation marks; that is dropped
 * here rather than shown, and the flag is shown without it.
 */
export function verbatimQuote(
  quote: string,
  passages: ReadonlyArray<{ text: string }>,
): string | null {
  const normalise = (text: string) => text.replace(/\s+/g, ' ').trim();
  const candidate = normalise(quote).replace(/^["'“‘]+|["'”’]+$/g, '');
  if (candidate.length < 4) return null;
  return passages.some((passage) => normalise(passage.text).includes(candidate)) ? candidate : null;
}

// ---------------------------------------------------------------------------------------------
// A.12.4 OUTLINE_DRIFT
// ---------------------------------------------------------------------------------------------

export const outlineDriftSchema = z.object({
  covered: z.array(z.string()).default([]),
  missing: z.array(z.string()).default([]),
  extra: z.array(z.string()).default([]),
  explanation: z.string().max(600).default(''),
});
export type OutlineDriftResult = z.infer<typeof outlineDriftSchema>;

/** A.12.4's summary step: Fast tier, "topics, not quality". */
export function buildChapterSummaryRequest(input: {
  chapterTitle: string;
  chapterText: string;
  userId: string;
  documentId: string;
  signal?: AbortSignal;
}): Omit<LlmRequest, 'schema'> {
  return {
    tier: 'fast',
    system: {
      cached: `${loadPrompt('_preamble').system}\n\nSummarise what this chapter covers in ${COHERENCE.summaryWords} words; list topics, not quality.`,
    },
    messages: [
      {
        role: 'user',
        content: `<chapter title="${input.chapterTitle.replace(/"/g, "'")}">\n${input.chapterText}\n</chapter>`,
      },
    ],
    maxTokens: 400,
    temperature: 0,
    action: 'COHERENCE',
    userId: input.userId,
    documentId: input.documentId,
    ...(input.signal ? { signal: input.signal } : {}),
  };
}

export function buildOutlineDriftRequest(input: {
  scopeNote: string;
  summary: string;
  userId: string;
  documentId: string;
  signal?: AbortSignal;
}): Omit<LlmRequest, 'schema'> {
  const user = [
    `<scope_note>${input.scopeNote}</scope_note>`,
    `<chapter_summary>${input.summary}</chapter_summary>`,
  ].join('\n');
  return request('coh_outline', user, { maxTokens: 800, ...input });
}

// ---------------------------------------------------------------------------------------------
// Fingerprints (ADR-0007)
// ---------------------------------------------------------------------------------------------

/**
 * `type + chapterId + normalised flagged text` (D.1.1). Normalised so that re-wrapping a paragraph
 * or changing its punctuation does not resurrect a flag the student already dealt with, while a
 * real edit to the sentence does produce a new one.
 */
export function flagFingerprint(type: string, chapterId: string, text: string): string {
  const normalised = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 300);
  return `${type}:${chapterId}:${normalised}`;
}

// ---------------------------------------------------------------------------------------------
// Mock (AI_PROVIDER=mock)
// ---------------------------------------------------------------------------------------------

/**
 * A mock that answers every coherence prompt from the text it was given and finds only what is
 * literally there: a term used in a sentence that also contains its own negation, a claim whose
 * number differs from a passage's number for the same subject, a sentence the heuristic already
 * selected, and outline items the summary does not mention. It reports nothing it cannot point at.
 */
export const mockCoherenceResponse = {
  match: (req: { action: string }) => req.action === 'COHERENCE',
  respond: (req: { messages: ReadonlyArray<{ content: string }> }): unknown => {
    const text = req.messages.at(-1)?.content ?? '';

    // A.12.4 — the scope note against the summary.
    if (text.includes('<scope_note>')) {
      const scope = /<scope_note>([\s\S]*?)<\/scope_note>/.exec(text)?.[1] ?? '';
      const summary = /<chapter_summary>([\s\S]*?)<\/chapter_summary>/.exec(text)?.[1] ?? '';
      const words = new Set(
        summary
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((w) => w.length > 4),
      );
      const promised = scope
        .split(/[;,.]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 12);
      const missing = promised.filter((item) => {
        const keys = item
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((w) => w.length > 4);
        return keys.length > 0 && !keys.some((k) => words.has(k));
      });
      return {
        covered: promised.filter((p) => !missing.includes(p)).slice(0, 4),
        missing: missing.slice(0, 2),
        extra: [],
        explanation: missing.length
          ? 'The summary does not mention every topic the scope note promised (mock).'
          : 'The chapter covers what its scope note promised (mock).',
      };
    }

    // ADR-0023 — each cited sentence against its passages. Only what is literally there: a figure
    // the passages do not contain, certainty where the passage hedges, or no shared subject.
    if (text.includes('<support_check>')) {
      const results = [...text.matchAll(/<sentence id="([^"]+)">([\s\S]*?)<\/sentence>/g)].map(
        ([, sentenceId, sentence]) => {
          const passages = [
            ...text.matchAll(
              new RegExp(`<passage for="${sentenceId}"[^>]*>([\\s\\S]*?)</passage>`, 'g'),
            ),
          ].map((m) => m[1] ?? '');
          const joined = passages.join(' ');
          // A verbatim span to quote: the first sentence of a passage matching `pick`.
          const quoteFrom = (pick: RegExp) => {
            for (const passage of passages) {
              const found = passage.split(/(?<=[.!?])\s+/).find((s) => pick.test(s));
              if (found) return found.split(/\s+/).slice(0, 25).join(' ');
            }
            return '';
          };
          const figure = numbersIn(sentence ?? '').find(
            (n) => numbersIn(joined).length > 0 && !numbersIn(joined).includes(n),
          );
          if (figure !== undefined) {
            return {
              sentenceId,
              verdict: 'MISREPRESENTED',
              why: `The passage gives a different figure from ${figure} (mock).`,
              quote: quoteFrom(/\d/),
            };
          }
          const certain = /\b(?:all|always|every|never|proves?|must)\b/i;
          const hedged = /\b(?:may|might|some|suggests?|could|partly|in part)\b/i;
          if (certain.test(sentence ?? '') && hedged.test(joined)) {
            return {
              sentenceId,
              verdict: 'OVERSTATED',
              why: 'The passage hedges what the sentence states outright (mock).',
              quote: quoteFrom(hedged),
            };
          }
          if (!sharesSubject(sentence ?? '', joined)) {
            return {
              sentenceId,
              verdict: 'NOT_IN_PASSAGE',
              why: 'The passages are about something else (mock).',
              quote: '',
            };
          }
          return {
            sentenceId,
            verdict: 'SUPPORTED',
            why: 'The passage states it (mock).',
            quote: '',
          };
        },
      );
      return { results };
    }

    // A.12.2 step 2 — claims against retrieved passages.
    if (text.includes('<comparison>')) {
      const flags: Array<Record<string, unknown>> = [];
      const claims = [
        ...text.matchAll(/<claim id="([^"]+)">([\s\S]*?)<\/claim>([\s\S]*?)(?=<claim |$)/g),
      ];
      for (const [, claimId, claimText, rest] of claims) {
        const claimNumbers = numbersIn(claimText ?? '');
        if (claimNumbers.length === 0) continue;
        for (const passage of [
          ...(rest ?? '').matchAll(/<passage id="([^"]+)"[^>]*>([\s\S]*?)<\/passage>/g),
        ]) {
          const passageNumbers = numbersIn(passage[2] ?? '');
          const conflict = claimNumbers.find(
            (n) => passageNumbers.length > 0 && !passageNumbers.includes(n),
          );
          if (conflict !== undefined && sharesSubject(claimText ?? '', passage[2] ?? '')) {
            flags.push({
              claimId,
              passageId: passage[1],
              severity: 'WARN',
              explanation: `The figure ${conflict} here does not match the figure in the other chapter (mock).`,
            });
            break;
          }
        }
      }
      return { flags };
    }

    // A.12.2 step 1 — claim extraction.
    if (text.includes('<chapter ') && text.includes('Extract at most')) {
      const body = /<chapter[^>]*>([\s\S]*?)<\/chapter>/.exec(text)?.[1] ?? '';
      const max = Number(/Extract at most (\d+)/.exec(text)?.[1] ?? COHERENCE.maxClaims);
      const claims = body
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 30 && /\d/.test(s))
        .slice(0, max)
        .map((s, i) => ({ id: `c${i + 1}`, text: s }));
      return { claims };
    }

    // A.12.3 — the pre-filtered sentences.
    if (text.includes('<chapter_role>')) {
      const results = [...text.matchAll(/^- ([^|]+) \| (.*)$/gm)].map((m) => {
        const sentence = (m[2] ?? '').trim();
        const needsSupport = /\d/.test(sentence) || /\bstudies|research|shown\b/i.test(sentence);
        return {
          sentenceId: (m[1] ?? '').trim(),
          needsSupport,
          why: needsSupport ? 'states a figure or attributes a finding' : '',
        };
      });
      return { results };
    }

    // A.12.1 — the term's sentences.
    if (text.includes('<term>')) {
      const term = (/<term>([\s\S]*?)<\/term>/.exec(text)?.[1] ?? '').trim().toLowerCase();
      const flags = [...text.matchAll(/^- ([^|]+) \| ([^|]*) \| (.*)$/gm)]
        .filter((m) => {
          const sentence = (m[3] ?? '').toLowerCase();
          // Only what is literally contradictory: the term next to a negation of itself.
          return (
            sentence.includes(term) &&
            /\b(?:not|never|rather than|instead of|unlike)\b/.test(sentence)
          );
        })
        .slice(0, 3)
        .map((m) => ({
          sentenceId: (m[1] ?? '').trim(),
          kind: 'drift' as const,
          explanation: 'Uses the term alongside a negation of its stored definition (mock).',
        }));
      return { flags };
    }

    return { flags: [] };
  },
};

function numbersIn(text: string): string[] {
  return [...text.matchAll(/\b\d[\d,]*(?:\.\d+)?%?\b/g)]
    .map((m) => m[0])
    .filter((n) => n.replace(/\D/g, '').length >= 2);
}

/** Two texts are about the same thing when they share an uncommon word. */
function sharesSubject(a: string, b: string): boolean {
  const words = (t: string) =>
    new Set(
      t
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter((w) => w.length > 5),
    );
  const wa = words(a);
  for (const w of words(b)) if (wa.has(w)) return true;
  return false;
}
