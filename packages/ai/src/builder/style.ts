/**
 * Style profile — PRD FR-4.7, Appendix A.10, PHASES v2 W9.1.
 *
 *   "after ≥ 1,500 words of *original* text (accepted AI text excluded — track via provenance
 *    marks), a one-time strong-tier call infers sentence length, formality, voice and transition
 *    habits. Stored in `DocumentMemory.styleProfile`; included in the cached system block."
 *
 * The sample is HUMAN-marked text only, taken from the end of each chapter's own writing so it
 * reflects how the student writes now. The threshold is counted from provenance, not from the
 * chapter word count, so a document full of accepted drafts never triggers it.
 */

import { z } from 'zod';
import { loadPrompt } from '../prompts.js';
import type { LlmRequest } from '../types.js';

export const STYLE = {
  tier: 'strong',
  maxTokens: 600,
  temperature: 0,
  /** FR-4.7: "after ≥ 1,500 words of original text". */
  thresholdWords: 1_500,
  /** A.10: "up to 1,500 words of text with HUMAN provenance only". */
  sampleWords: 1_500,
} as const;

export const styleProfileSchema = z.object({
  avgSentenceLen: z.number().min(1).max(120),
  register: z.enum(['formal', 'semi-formal']),
  voice: z.enum(['first-person', 'passive', 'mixed']),
  transitions: z.array(z.string().trim().min(1)).max(8).default([]),
  hedging: z.enum(['low', 'medium', 'high']).default('medium'),
  voiceNote: z.string().trim().min(1).max(600),
});
export type StyleProfileResult = z.infer<typeof styleProfileSchema>;

export type StyleBuildInput = {
  /** HUMAN-provenance text only, already concatenated. */
  sample: string;
  userId: string;
  documentId: string;
  signal?: AbortSignal;
};

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean);

/** The last N words of the sample: how the student writes now, not how they started. */
export function trimSample(sample: string, max = STYLE.sampleWords): string {
  const list = words(sample);
  return list.length <= max ? list.join(' ') : list.slice(list.length - max).join(' ');
}

export function buildStyleRequest(input: StyleBuildInput): Omit<LlmRequest, 'schema'> {
  return {
    tier: STYLE.tier,
    // A.10 is a once-per-document call over a sample that changes every time; nothing to cache.
    system: { cached: `${loadPrompt('_preamble').system}\n\n${loadPrompt('style').system}` },
    messages: [{ role: 'user', content: `<sample>\n${trimSample(input.sample)}\n</sample>` }],
    maxTokens: STYLE.maxTokens,
    temperature: STYLE.temperature,
    action: 'STYLE_PROFILE',
    userId: input.userId,
    documentId: input.documentId,
    ...(input.signal ? { signal: input.signal } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// Provenance-aware word counting (FR-4.7, FR-4.11)
// ---------------------------------------------------------------------------------------------

type PmNode = {
  type?: string;
  text?: string;
  marks?: Array<{ type: string; attrs?: { kind?: string } }>;
  content?: PmNode[];
};

/**
 * Words and text by provenance kind. Unmarked text is HUMAN (B.4), `HUMAN_EDITED` counts as the
 * student's own — they rewrote it — and `ASSIST`/`DRAFT`/`COMMAND` do not.
 */
export function humanText(doc: unknown): { words: number; text: string } {
  const parts: string[] = [];
  let count = 0;
  const walk = (node: PmNode | undefined): void => {
    if (!node) return;
    if (node.type === 'text' && node.text) {
      const kind = node.marks?.find((m) => m.type === 'provenance')?.attrs?.kind ?? 'HUMAN';
      if (kind === 'HUMAN' || kind === 'HUMAN_EDITED') {
        parts.push(node.text);
        count += words(node.text).length;
      }
    }
    for (const child of node.content ?? []) walk(child);
    // Block boundaries become spaces so sentences do not run together in the sample.
    if (node.type === 'paragraph' || node.type === 'heading') parts.push('\n');
  };
  walk(doc as PmNode);
  return {
    words: count,
    text: parts
      .join(' ')
      .replace(/[ \t]+/g, ' ')
      .trim(),
  };
}

// ---------------------------------------------------------------------------------------------
// Mock (AI_PROVIDER=mock)
// ---------------------------------------------------------------------------------------------

const TRANSITION_CANDIDATES = [
  'however',
  'in contrast',
  'therefore',
  'moreover',
  'nevertheless',
  'for example',
  'in addition',
  'by contrast',
  'as a result',
  'on the other hand',
];

const HEDGES = ['may', 'might', 'could', 'appears', 'suggests', 'possibly', 'likely', 'seems'];

/**
 * A profile measured from the sample rather than judged: mean sentence length, first-person and
 * passive counts, the transition phrases that actually occur, hedge density. The `voiceNote` is
 * assembled from those measurements, so it says only what the text shows.
 */
export const mockStyleResponse = {
  match: (req: { action: string }) => req.action === 'STYLE_PROFILE',
  respond: (req: { messages: ReadonlyArray<{ content: string }> }): StyleProfileResult => {
    const sample =
      /<sample>([\s\S]*?)<\/sample>/.exec(req.messages.at(-1)?.content ?? '')?.[1] ?? '';
    const lower = sample.toLowerCase();
    const sentences = sample.split(/[.!?]+\s/).filter((s) => s.trim().length > 0);
    const wordCount = words(sample).length;
    const avgSentenceLen = sentences.length > 0 ? Math.round(wordCount / sentences.length) : 18;

    const firstPerson = (lower.match(/\b(i|we|our|my)\b/g) ?? []).length;
    const passive = (lower.match(/\b(was|were|is|are|been|being)\s+\w+(ed|en)\b/g) ?? []).length;
    const voice: StyleProfileResult['voice'] =
      firstPerson > passive * 1.5
        ? 'first-person'
        : passive > firstPerson * 1.5
          ? 'passive'
          : 'mixed';

    const transitions = TRANSITION_CANDIDATES.filter((t) => lower.includes(t)).slice(0, 8);
    const hedgeCount = HEDGES.reduce(
      (n, h) => n + (lower.match(new RegExp(`\\b${h}\\b`, 'g')) ?? []).length,
      0,
    );
    const per100 = wordCount > 0 ? (hedgeCount / wordCount) * 100 : 0;
    const hedging: StyleProfileResult['hedging'] =
      per100 > 2 ? 'high' : per100 > 0.7 ? 'medium' : 'low';
    const contractions = /\b(don't|isn't|can't|it's|doesn't|won't)\b/i.test(sample);

    return {
      avgSentenceLen: Math.max(1, Math.min(120, avgSentenceLen)),
      register: contractions ? 'semi-formal' : 'formal',
      voice,
      transitions,
      hedging,
      voiceNote: [
        `Writes ${avgSentenceLen}-word sentences on average, in a ${contractions ? 'semi-formal' : 'formal'} register.`,
        voice === 'first-person'
          ? 'Uses the first person for the work done.'
          : voice === 'passive'
            ? 'Prefers the passive for the work done.'
            : 'Mixes first person and passive.',
        transitions.length > 0
          ? `Connects with ${transitions.slice(0, 3).join(', ')}.`
          : 'Uses few explicit transition phrases.',
        `Hedges ${hedging === 'high' ? 'often' : hedging === 'medium' ? 'moderately' : 'rarely'}.`,
      ].join(' '),
    };
  },
};
