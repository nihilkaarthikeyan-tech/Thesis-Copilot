/**
 * Tone review — ADR-0084 (row 57 of the Jenni coverage map, 2026-10-05).
 *
 * Jenni's "tone of voice" card reviews written text against a chosen tone, which can be a paper
 * from the library. Ours had the writing profile (A.10) steering suggestions, and nothing that
 * read what the student had already written. This is that review: each sentence of a chapter
 * compared with a sample — the student's own profile, or a passage of a library paper they chose —
 * and a rewrite offered where the tone clearly differs. Shown like proofreading corrections;
 * nothing changes until the student accepts one (flag, don't fix).
 *
 * Metered as `COMMAND`, like proofreading (ADR-0026): one unit a run of up to `maxWords`.
 */

import { z } from 'zod';
import { loadPrompt } from '../prompts.js';
import type { LlmRequest } from '../types.js';
import type { StyleProfile } from './memory.js';
import type { ProofreadSentence } from './proofread.js';

export const TONE = {
  tier: 'fast',
  maxTokens: 2_000,
  temperature: 0.2,
  /** Sentences per call. Rewrites are longer than corrections, so fewer than proofreading's 40. */
  batch: 30,
  /** Words read per run; the rest is a second run, as proofreading does. */
  maxWords: 2_000,
  /** Words of a library paper used as the sample. */
  sampleWords: 600,
  /** A rewrite's length against its sentence, in words. Outside this it is not the same sentence. */
  minRatio: 0.4,
  maxRatio: 2.5,
} as const;

export const toneSchema = z.object({
  items: z.array(
    z.object({
      sentenceId: z.string(),
      why: z.string(),
      rewrite: z.string(),
    }),
  ),
});
export type ToneResult = z.infer<typeof toneSchema>;

export type ToneItem = {
  sentenceId: string;
  original: string;
  replacement: string;
  kind: 'tone';
  why: string;
};

/** The student's own profile as a sample the prompt can match against. */
export function renderStyleSample(profile: StyleProfile, guidance = ''): string {
  const lines = [
    `Register: ${profile.register}. Voice: ${profile.voice}. Hedging: ${profile.hedging ?? 'medium'}.`,
    `Typical sentence length: about ${Math.round(profile.avgSentenceLen)} words.`,
    profile.transitions.length > 0 ? `Transitions used: ${profile.transitions.join(', ')}.` : '',
    profile.voiceNote ? `How they write: ${profile.voiceNote}` : '',
    guidance.trim() ? `Their own guidance: ${guidance.trim()}` : '',
    ...(profile.sample?.length
      ? ['Examples of their sentences:', ...profile.sample.map((s) => `- ${s}`)]
      : []),
  ];
  return lines.filter(Boolean).join('\n');
}

export function buildToneRequest(input: {
  sentences: readonly ProofreadSentence[];
  sample: string;
  language?: string | null;
  userId: string;
  documentId: string;
  signal?: AbortSignal;
}): Omit<LlmRequest, 'schema'> {
  const user = [
    '<tone>',
    ...(input.language ? [`<language>${input.language}</language>`] : []),
    `<sample>\n${input.sample.trim()}\n</sample>`,
    ...input.sentences.slice(0, TONE.batch).map((s) => `- ${s.id} | ${s.text}`),
    '</tone>',
  ].join('\n');
  return {
    tier: TONE.tier,
    system: { cached: `${loadPrompt('_preamble').system}\n\n${loadPrompt('tone').system}` },
    messages: [{ role: 'user', content: user }],
    maxTokens: TONE.maxTokens,
    temperature: TONE.temperature,
    action: 'COMMAND',
    userId: input.userId,
    documentId: input.documentId,
    ...(input.signal ? { signal: input.signal } : {}),
  };
}

const CITE = /\{\{cite:([^}]+)\}\}/g;
const words = (text: string) => text.trim().split(/\s+/).filter(Boolean);
const norm = (text: string) => text.replace(/\s+/g, ' ').trim();

function citeKeys(text: string): string[] {
  return [...text.matchAll(CITE)].map((m) => (m[1] ?? '').trim()).sort();
}

/**
 * The rules checked in code: the sentence is in the batch; the rewrite is a different sentence
 * with the same citations and a length that is still that sentence's. One item per sentence.
 */
export function postProcessTone(
  result: ToneResult,
  batch: readonly ProofreadSentence[],
): { items: ToneItem[]; refused: number } {
  const byId = new Map(batch.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const items: ToneItem[] = [];
  let refused = 0;
  for (const item of result.items) {
    const sentence = byId.get(item.sentenceId);
    if (!sentence || seen.has(item.sentenceId)) continue;
    const rewrite = norm(item.rewrite);
    const original = norm(sentence.text);
    if (!rewrite || rewrite === original) continue;
    const ratio = words(rewrite).length / Math.max(1, words(original).length);
    const sameCites = JSON.stringify(citeKeys(rewrite)) === JSON.stringify(citeKeys(original));
    if (!sameCites || ratio < TONE.minRatio || ratio > TONE.maxRatio) {
      refused++;
      continue;
    }
    seen.add(item.sentenceId);
    items.push({
      sentenceId: item.sentenceId,
      original: sentence.text,
      replacement: rewrite,
      kind: 'tone',
      why: norm(item.why).slice(0, 160),
    });
  }
  return { items, refused };
}

/** A sample of a paper: its first passages, cut at a sentence end near `TONE.sampleWords`. */
export function paperSample(
  chunks: readonly string[],
  maxWords: number = TONE.sampleWords,
): string {
  const out: string[] = [];
  let count = 0;
  for (const chunk of chunks) {
    const text = norm(chunk);
    if (!text) continue;
    out.push(text);
    count += words(text).length;
    if (count >= maxWords) break;
  }
  const joined = out.join('\n\n');
  const all = words(joined);
  if (all.length <= maxWords) return joined;
  const head = all.slice(0, maxWords).join(' ');
  const end = head.lastIndexOf('. ');
  return end > head.length * 0.6 ? head.slice(0, end + 1) : head;
}

/**
 * The mock: a sentence with a conversational marker is rewritten without it, citations kept —
 * enough to see the review, the Accept and the Y / N keys work without a provider.
 */
const CHATTY: Array<[RegExp, string]> = [
  [/\ba lot of\b/gi, 'many'],
  [/\breally\s+/gi, ''],
  [/\bvery\s+/gi, ''],
  [/\bkind of\s+/gi, ''],
  [/\bpretty\s+(?=\w)/gi, ''],
];

export const mockToneResponse = {
  match: (req: { action: string; messages: ReadonlyArray<{ content: string }> }) =>
    req.action === 'COMMAND' && (req.messages.at(-1)?.content ?? '').includes('<tone>'),
  respond: (req: { messages: ReadonlyArray<{ content: string }> }): ToneResult => {
    const text = req.messages.at(-1)?.content ?? '';
    const body = text.split('</sample>')[1] ?? text;
    const items: ToneResult['items'] = [];
    for (const [, id, sentence] of body.matchAll(/^- ([^|]+) \| (.*)$/gm)) {
      const original = (sentence ?? '').trim();
      const rewrite = CHATTY.reduce((s, [re, to]) => s.replace(re, to), original)
        .replace(/\s{2,}/g, ' ')
        .trim();
      if (rewrite !== original) {
        items.push({ sentenceId: (id ?? '').trim(), why: 'Conversational wording', rewrite });
      }
    }
    return { items };
  },
};
