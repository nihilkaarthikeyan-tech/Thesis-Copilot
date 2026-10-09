/**
 * Proofreading — ADR-0026. Spelling, grammar, punctuation and agreement, one small correction at a
 * time, each accepted or dismissed by the student.
 *
 * The line this file holds is the one between proofreading and rewriting. A proofreader changes a
 * word or two where something is wrong; a rewriter produces new sentences, and a tool that
 * produces new sentences on request is a paraphraser, which PRD §12.3 rules out. So the prompt
 * asks for the smallest correction, and `postProcessProofread` refuses anything that is not one:
 * a span it cannot place, or a change that puts a different word in (`correctionSize`). What
 * survives is split into one correction per change and shown for the student to take or leave.
 *
 * Metered as one `COMMAND` unit per run (ADR-0026, following ADR-0008): a whole chapter at the
 * Fast tier costs less than one Strong-tier command, so it fits under the ₹100 ceiling without a
 * cap of its own.
 */

import { z } from 'zod';
import { loadPrompt } from '../prompts.js';
import type { LlmRequest } from '../types.js';
import { countDashes } from './academic-style.js';

export const PROOFREAD = {
  tier: 'fast',
  maxTokens: 1_500,
  temperature: 0,
  /** Sentences per call. */
  batch: 40,
  /**
   * Words read per run; the rest of a long chapter waits for the next. A run is charged as one
   * `COMMAND` unit, and ADR-0008's rule is that a shared unit is priced for the most expensive
   * thing that draws on it. At the budget's prices (Appendix E.2) 2,000 words, at the measured
   * rates below, is what one unit pays for; a test holds the two together.
   */
  maxWords: 2_000,
  /** The largest span a correction may cover, in words. */
  maxSpanWords: 8,
  /** Words a correction may change, beyond which it is a rewrite. */
  maxChangedWords: 3,
} as const;

/**
 * Tokens per word read, measured 2026-09-24 on `gpt-5-nano`: a 5,004-word run in batches of 40,
 * 12,578 tokens in and 5,518 out. The text had a mistake in three sentences of every ten, far more
 * than a real draft, and output grows with the mistakes found — so these are a ceiling, which is
 * the right side to be wrong on when they size what a unit buys.
 */
export const PROOFREAD_TOKENS_PER_WORD = { input: 2.52, output: 1.11 } as const;

export const PROOFREAD_KINDS = ['spelling', 'grammar', 'punctuation', 'agreement'] as const;
export type ProofreadKind = (typeof PROOFREAD_KINDS)[number];
const isKind = (kind: string): kind is ProofreadKind =>
  (PROOFREAD_KINDS as readonly string[]).includes(kind);

/**
 * Written for OpenAI's strict Structured Outputs: no defaults and no length limits, so every field
 * is required and the model cannot return another shape (see `providers/openai.ts`). With
 * `.default()` in it the schema fell back to JSON mode, where the model named its own kinds —
 * "doubling", "style" — and one such label failed validation for a whole batch of forty sentences
 * (measured 2026-09-24, one batch in nine). `kind` is therefore a plain string, and an unknown one
 * is relabelled by what the change does (`kindOf`); lengths are the post-processing's job.
 */
export const proofreadSchema = z.object({
  corrections: z.array(
    z.object({
      sentenceId: z.string(),
      original: z.string(),
      replacement: z.string(),
      kind: z.string(),
      why: z.string(),
    }),
  ),
});
export type ProofreadResult = z.infer<typeof proofreadSchema>;

export type ProofreadSentence = { id: string; text: string };

export function buildProofreadRequest(input: {
  sentences: readonly ProofreadSentence[];
  language?: string | null;
  userId: string;
  documentId: string;
  signal?: AbortSignal;
}): Omit<LlmRequest, 'schema'> {
  const user = [
    '<proofread>',
    ...(input.language ? [`<language>${input.language}</language>`] : []),
    ...input.sentences.slice(0, PROOFREAD.batch).map((s) => `- ${s.id} | ${s.text}`),
    '</proofread>',
  ].join('\n');
  return {
    tier: PROOFREAD.tier,
    system: { cached: `${loadPrompt('_preamble').system}\n\n${loadPrompt('proofread').system}` },
    messages: [{ role: 'user', content: user }],
    maxTokens: PROOFREAD.maxTokens,
    temperature: PROOFREAD.temperature,
    // ADR-0026: metered against the Commands allowance, like FR-3.6 (ADR-0008).
    action: 'COMMAND',
    userId: input.userId,
    documentId: input.documentId,
    ...(input.signal ? { signal: input.signal } : {}),
  };
}

export type Correction = {
  sentenceId: string;
  original: string;
  replacement: string;
  kind: ProofreadKind;
  why: string;
};

const words = (text: string): string[] => text.trim().split(/\s+/).filter(Boolean);

/** `table[i][j]`: the longest common subsequence of `a[i..]` and `b[j..]`. */
function lcsTable(a: readonly string[], b: readonly string[]): number[][] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      const row = table[i] as number[];
      row[j] =
        a[i] === b[j]
          ? (table[i + 1]?.[j + 1] ?? 0) + 1
          : Math.max(table[i + 1]?.[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  return table;
}

/** Words the correction removes or adds — the size of the edit, not of the span. */
export function changedWords(original: string, replacement: string): number {
  const before = words(original);
  const after = words(replacement);
  // What stays is what is not changed.
  const kept = lcsTable(before, after)[0]?.[0] ?? 0;
  return Math.max(before.length, after.length) - kept;
}

// ---------------------------------------------------------------------------------------------
// What a correction may change — PRD §12.3
// ---------------------------------------------------------------------------------------------

/**
 * Grammar words that may stand in for one another: agreement, case, article, the confusable
 * pairs. Swapping a word for another in its set is grammar. Swapping across sets, or for anything
 * outside them, is wording — "more" for "less", "with" for "without" — and wording is the
 * student's. Deliberately absent everywhere: not, no, never, and every quantifier but less/fewer.
 */
const GRAMMAR_SETS: ReadonlyArray<ReadonlySet<string>> = [
  'a an the',
  'am is are was were be been being',
  'has have had having',
  'do does did',
  'who whom whose which that',
  'this these that those',
  'it its they them their theirs there',
  'less fewer',
  'much many',
  'then than',
  'to too',
  'in on at of to for by from into onto about with',
].map((set) => new Set(set.split(' ')));

/** Grammar words that may be added or removed on their own: a missing article, a doubled "is". */
const ADDABLE: ReadonlySet<string> = new Set(
  [
    'a an the of to that as',
    'is are was were be been has have had it there',
    'for in on at by with about from into onto upon',
  ]
    .join(' ')
    .split(' '),
);

/** Prefixes that make a word its opposite: "insignificant" is not "significant" misspelt. */
const NEGATING = ['un', 'in', 'im', 'il', 'ir', 'non', 'non-', 'dis'];

const bare = (word: string) => word.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
const lettersOf = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const punctuationOnly = (word: string) => !/[\p{L}\p{N}]/u.test(word);

/** Edits between two words, a swapped pair of letters counting as one ("recieved"). */
function distance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const row = d[i] as number[];
      const up = d[i - 1] as number[];
      const same = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min((up[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (up[j - 1] ?? 0) + same);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        row[j] = Math.min(row[j] ?? 0, (d[i - 2]?.[j - 2] ?? 0) + 1);
      }
    }
  }
  return d[a.length]?.[b.length] ?? 0;
}

/** One word for another is a correction when it is the same word spelt right, or grammar. */
function substitutable(before: string, after: string): boolean {
  const a = bare(before);
  const b = bare(after);
  if (a === b) return true;
  if (GRAMMAR_SETS.some((set) => set.has(a) && set.has(b))) return true;
  if (NEGATING.some((prefix) => a === prefix + b || b === prefix + a)) return false;
  // Numbers are the student's data, never a typo to fix.
  if (/\p{N}/u.test(a + b)) return false;
  return distance(a, b) <= Math.max(1, Math.floor(Math.max(a.length, b.length) / 3));
}

function droppable(tokens: readonly string[], i: number): boolean {
  const word = tokens[i] as string;
  const b = bare(word);
  const doubled =
    (i > 0 && bare(tokens[i - 1] as string) === b) ||
    (i + 1 < tokens.length && bare(tokens[i + 1] as string) === b);
  return punctuationOnly(word) || ADDABLE.has(b) || doubled;
}

const addable = (word: string) => punctuationOnly(word) || ADDABLE.has(bare(word));

const AGREEMENT: ReadonlySet<string> = new Set(
  'am is are was were be been being has have had having do does did'.split(' '),
);

/** What a correction does, read off the change itself. */
export function kindOf(before: string, after: string): ProofreadKind {
  if (lettersOf(before) === lettersOf(after)) return 'punctuation';
  const a = words(before);
  const b = words(after);
  if (a.length !== b.length) return 'grammar';
  const changed = a.flatMap((word, i) => (word === b[i] ? [] : [[bare(word), bare(b[i] ?? '')]]));
  if (changed.every(([x, y]) => AGREEMENT.has(x ?? '') && AGREEMENT.has(y ?? ''))) {
    return 'agreement';
  }
  if (changed.some(([x, y]) => GRAMMAR_SETS.some((set) => set.has(x ?? '') && set.has(y ?? '')))) {
    return 'grammar';
  }
  return 'spelling';
}

/**
 * How many words a correction changes, or null when it is not a correction.
 *
 * A proofreader fixes a word's spelling or inflection, puts one grammar word in place of another
 * of its kind, adds or removes a grammar word, punctuation or a doubled word, and changes spacing,
 * hyphens and capitals. It does not put a different word in. That is the whole line between
 * proofreading and paraphrasing (PRD §12.3), and it is drawn here in code rather than left to the
 * prompt: a synonym swap, an inserted "not", or "more" for "less" is refused whatever the model
 * calls it. An antonym that happens to be one letter away is the one thing this cannot see, and
 * the student reads every correction before accepting it.
 */
export function correctionSize(before: string, after: string): number | null {
  if (before === after) return 0;
  if (lettersOf(before) === lettersOf(after)) return 1;
  const a = words(before);
  const b = words(after);
  const cost: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(Number.POSITIVE_INFINITY),
  );
  (cost[0] as number[])[0] = 0;
  for (let i = 0; i <= a.length; i++) {
    for (let j = 0; j <= b.length; j++) {
      if (i === 0 && j === 0) continue;
      let best = Number.POSITIVE_INFINITY;
      if (i > 0 && j > 0) {
        const diagonal = cost[i - 1]?.[j - 1] ?? Number.POSITIVE_INFINITY;
        if (a[i - 1] === b[j - 1]) best = Math.min(best, diagonal);
        else if (substitutable(a[i - 1] as string, b[j - 1] as string)) {
          best = Math.min(best, diagonal + 1);
        }
      }
      if (i > 0 && droppable(a, i - 1)) {
        best = Math.min(best, (cost[i - 1]?.[j] ?? Number.POSITIVE_INFINITY) + 1);
      }
      if (j > 0 && addable(b[j - 1] as string)) {
        best = Math.min(best, (cost[i]?.[j - 1] ?? Number.POSITIVE_INFINITY) + 1);
      }
      (cost[i] as number[])[j] = best;
    }
  }
  const total = cost[a.length]?.[b.length] ?? Number.POSITIVE_INFINITY;
  return Number.isFinite(total) ? total : null;
}

const occurrences = (text: string, needle: string) => {
  let n = 0;
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) n++;
  return n;
};

/**
 * The smallest run of whole words that carries the change, and what it becomes.
 *
 * Asked for "the shortest span", a Fast model still sometimes answers with the whole sentence and
 * one word fixed in it — the first real run did exactly that for both of its corrections. That is
 * a correction, not a rewrite, and it should reach the student as one: "recieved" → "received",
 * not the sentence twice. So what the two versions share at the start and the end is trimmed off,
 * the rest is widened back out to whole words (never starting or ending on a space, never empty),
 * and then widened a word at a time until it occurs once in the sentence, which is what placing
 * it needs. `original` must already be in `sentence` exactly once. Null when nothing changes.
 */
export function narrowCorrection(
  original: string,
  replacement: string,
  sentence: string,
): { original: string; replacement: string } | null {
  if (original === replacement) return null;
  const o = original;
  const r = replacement;
  let prefix = 0;
  while (prefix < o.length && prefix < r.length && o[prefix] === r[prefix]) prefix++;
  let suffix = 0;
  const room = Math.min(o.length, r.length) - prefix;
  while (suffix < room && o[o.length - 1 - suffix] === r[r.length - 1 - suffix]) suffix++;

  const space = (i: number) => i < 0 || i >= o.length || /\s/.test(o[i] as string);
  const wordStart = (i: number) => {
    let at = i;
    while (at > 0 && !space(at - 1)) at--;
    return at;
  };
  const wordEnd = (i: number) => {
    let at = i;
    while (at < o.length && !space(at)) at++;
    return at;
  };

  let start = prefix;
  let end = o.length - suffix;
  // A removed word and the space after it is the same edit as the space before it and the word:
  // "the |the |problem" slides to "the| the| problem", which widens to "the the" rather than to
  // "the problem". Diff tools make the same choice.
  while (
    r.length - suffix === prefix &&
    end > start &&
    start > 0 &&
    space(end - 1) &&
    o[start - 1] === o[end - 1]
  ) {
    start--;
    end--;
  }
  start = wordStart(start);
  if (end > start && !space(end - 1)) end = wordEnd(end);
  const growLeft = () => {
    if (start === 0) return false;
    while (start > 0 && space(start - 1)) start--;
    start = wordStart(start);
    return true;
  };
  const growRight = () => {
    if (end >= o.length) return false;
    while (end < o.length && space(end)) end++;
    end = wordEnd(end);
    return true;
  };
  // An insertion, or a span ending on a space, takes in the word after it (or before, at the end).
  if (end <= start || space(end - 1)) {
    if (!growRight()) growLeft();
  }
  if (space(start)) growLeft();

  // Stops at the whole original at worst, which the caller has found exactly once.
  while (occurrences(sentence, o.slice(start, end)) > 1) {
    if (!growLeft() && !growRight()) break;
  }
  return { original: o.slice(start, end), replacement: r.slice(start, end + r.length - o.length) };
}

type Token = { text: string; start: number; end: number };

const tokensOf = (text: string): Token[] =>
  [...text.matchAll(/\S+/g)].map((m) => ({
    text: m[0],
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
  }));

/**
 * One correction per change. A model that answers with the whole sentence and three fixes in it
 * (the first real run did) gets three corrections, each accepted or dismissed on its own, instead
 * of one span stretching from the first fix to the last.
 *
 * The words the two versions share are the anchors; each run of changed words between anchors is
 * narrowed within the anchors around it, so no correction reaches into another's words.
 */
export function splitCorrection(
  original: string,
  replacement: string,
  sentence: string,
): Array<{ original: string; replacement: string }> {
  const a = tokensOf(original);
  const b = tokensOf(replacement);
  const table = lcsTable(
    a.map((t) => t.text),
    b.map((t) => t.text),
  );
  type Hunk = { a0: number; a1: number; b0: number; b1: number };
  const hunks: Hunk[] = [];
  let open: Hunk | null = null;
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i]?.text === b[j]?.text) {
      if (open) hunks.push(open);
      open = null;
      i++;
      j++;
    } else if (
      j < b.length &&
      (i >= a.length || (table[i]?.[j + 1] ?? 0) >= (table[i + 1]?.[j] ?? 0))
    ) {
      open ??= { a0: i, a1: i, b0: j, b1: j };
      j++;
      open.b1 = j;
    } else {
      open ??= { a0: i, a1: i, b0: j, b1: j };
      i++;
      open.a1 = i;
    }
  }
  if (open) hunks.push(open);
  // Only the spacing differs: one correction, as it came.
  if (hunks.length === 0) {
    const whole = narrowCorrection(original, replacement, sentence);
    return whole ? [whole] : [];
  }

  const pieces: Array<{ original: string; replacement: string }> = [];
  for (let k = 0; k < hunks.length; k++) {
    const before = hunks[k - 1];
    const after = hunks[k + 1];
    const zone = {
      a0: before ? (a[before.a1]?.start ?? 0) : 0,
      a1: after ? (a[after.a0 - 1]?.end ?? original.length) : original.length,
      b0: before ? (b[before.b1]?.start ?? 0) : 0,
      b1: after ? (b[after.b0 - 1]?.end ?? replacement.length) : replacement.length,
    };
    const piece = narrowCorrection(
      original.slice(zone.a0, zone.a1),
      replacement.slice(zone.b0, zone.b1),
      sentence,
    );
    if (piece) pieces.push(piece);
  }
  return pieces;
}

/**
 * The corrections that are corrections. Refused: a sentence that was not sent, a span that is not
 * in the sentence word for word (or is there twice, so it could not be placed), no change at all, a
 * span longer than a correction needs, or a change that is not a correction (`correctionSize`) —
 * a rewrite, however it is labelled. What is kept is split into one correction per change and
 * narrowed to its words (`splitCorrection`), so the checks measure the edit, not how much the model
 * quoted. At most one correction per span.
 */
export function postProcessProofread(
  result: ProofreadResult,
  sentences: readonly ProofreadSentence[],
): { corrections: Correction[]; refused: number } {
  const byId = new Map(sentences.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const corrections: Correction[] = [];
  let refused = 0;
  for (const c of result.corrections) {
    const sentence = byId.get(c.sentenceId);
    if (
      !sentence ||
      c.original.trim().length === 0 ||
      occurrences(sentence.text, c.original) !== 1 ||
      c.original === c.replacement
    ) {
      refused += 1;
      continue;
    }
    const pieces = splitCorrection(c.original, c.replacement, sentence.text);
    if (pieces.length === 0) refused += 1;
    // The model's label and reason were for everything it changed at once. Once split, each piece
    // is labelled by what it actually does, and a reason that described all of them is not shown
    // against one.
    const split = pieces.length > 1;
    for (const { original, replacement } of pieces) {
      const key = `${c.sentenceId}:${original}`;
      const size = correctionSize(original, replacement);
      if (
        seen.has(key) ||
        occurrences(sentence.text, original) !== 1 ||
        words(original).length > PROOFREAD.maxSpanWords ||
        words(replacement).length > PROOFREAD.maxSpanWords ||
        size === null ||
        size > PROOFREAD.maxChangedWords ||
        // ADR-0147: a dash used as punctuation is never a correction a thesis needs.
        countDashes(replacement) > countDashes(original)
      ) {
        refused += 1;
        continue;
      }
      seen.add(key);
      corrections.push({
        sentenceId: c.sentenceId,
        original,
        replacement,
        kind:
          !split && isKind(c.kind.trim().toLowerCase())
            ? (c.kind.trim().toLowerCase() as ProofreadKind)
            : kindOf(original, replacement),
        why: split ? '' : c.why.trim().slice(0, 200),
      });
    }
  }
  return { corrections, refused };
}

// ---------------------------------------------------------------------------------------------
// Mock — finds only what is unmistakably an error, so a browser test has something to accept.
// ---------------------------------------------------------------------------------------------

/** Misspellings common enough to be unmistakable, with their corrections. */
const MISSPELLINGS: Readonly<Record<string, string>> = {
  teh: 'the',
  recieve: 'receive',
  recieved: 'received',
  occured: 'occurred',
  seperate: 'separate',
  enviroment: 'environment',
  definately: 'definitely',
  acheive: 'achieve',
  goverment: 'government',
  untill: 'until',
};

export const mockProofreadResponse = {
  match: (req: { action: string; messages: ReadonlyArray<{ content: string }> }) =>
    req.action === 'COMMAND' && (req.messages.at(-1)?.content ?? '').includes('<proofread>'),
  respond: (req: { messages: ReadonlyArray<{ content: string }> }): ProofreadResult => {
    const text = req.messages.at(-1)?.content ?? '';
    const corrections: ProofreadResult['corrections'] = [];
    for (const [, id, sentence] of text.matchAll(/^- ([^|]+) \| (.*)$/gm)) {
      const sentenceId = (id ?? '').trim();
      for (const word of (sentence ?? '').split(/[^A-Za-z]+/)) {
        const fixed = MISSPELLINGS[word.toLowerCase()];
        if (fixed) {
          corrections.push({
            sentenceId,
            original: word,
            replacement:
              word[0] === word[0]?.toUpperCase() ? fixed[0]?.toUpperCase() + fixed.slice(1) : fixed,
            kind: 'spelling',
            why: 'Misspelled (mock).',
          });
        }
      }
      // A doubled word, "the the".
      const doubled = /\b(\w+) \1\b/i.exec(sentence ?? '');
      if (doubled) {
        corrections.push({
          sentenceId,
          original: doubled[0],
          replacement: doubled[1] ?? '',
          kind: 'grammar',
          why: 'Repeated word (mock).',
        });
      }
    }
    return { corrections };
  },
};
