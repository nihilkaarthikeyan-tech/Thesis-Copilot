/**
 * Overlap report — ADR-0042. A read-only check that flags where a draft passage runs near-verbatim
 * to the text of a source the thesis holds, so the student can quote it properly or put it in their
 * own words. It is an integrity aid, the exact opposite of detector evasion (PRD §12.3): it points
 * at copied text, it never rewrites it, and it has no concept of a detector to beat. Nothing here
 * changes the thesis; the output is a report the student reads.
 *
 * The method is plain word-shingling — the transparent, explainable technique a plagiarism checker
 * uses — not a model: a run of consecutive words that also appears in a source is a match. No LLM,
 * no network, no metered unit.
 */

export type OverlapSourceText = {
  sourceId: string;
  /** A short label for the source, e.g. its short reference, shown beside a match. */
  label: string;
  text: string;
};

export type OverlapMatch = {
  sourceId: string;
  label: string;
  /** The shared run, as it reads in the draft passage. */
  quote: string;
  wordCount: number;
};

export type OverlapVerdict = 'clear' | 'review' | 'high';

export type OverlapReport = {
  /** Fraction of the passage's words that fall inside a matched run, 0–1. */
  overlapRatio: number;
  /** The longest single copied run, in words — the number an examiner reacts to. */
  longestRunWords: number;
  matches: OverlapMatch[];
  verdict: OverlapVerdict;
};

export const OVERLAP = {
  /** Shingle size: a shared window of this many words is the unit of a match. */
  shingle: 5,
  /** A covered run shorter than this is a common phrase, not a copy; dropped. */
  minRunWords: 8,
  /** Overlap ratio at or above this is flagged `high`; above `reviewAt` is `review`. */
  highAt: 0.3,
  reviewAt: 0.12,
} as const;

/** Word tokens with their span in the original text, so a match can be quoted back verbatim. */
type Token = { word: string; start: number; end: number };

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const re = /[\p{L}\p{N}]+/gu;
  let m: RegExpExecArray | null = re.exec(text);
  while (m !== null) {
    tokens.push({ word: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length });
    m = re.exec(text);
  }
  return tokens;
}

/** Every `n`-word shingle of a token list, as joined lowercase strings. */
function shingleSet(words: string[], n: number): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i + n <= words.length; i++) set.add(words.slice(i, i + n).join(' '));
  return set;
}

/**
 * Reports where `passage` runs near-verbatim to any of `sources`. A passage word is "covered" when
 * some `shingle`-word window starting at it occurs in a source; consecutive covered words form a
 * run, and a run of at least `minRunWords` is a match attributed to the source that carried its
 * first window.
 */
export function overlapReport(
  passage: string,
  sources: readonly OverlapSourceText[],
): OverlapReport {
  const tokens = tokenize(passage);
  const words = tokens.map((t) => t.word);
  const n = OVERLAP.shingle;
  if (words.length < n || sources.length === 0) {
    return { overlapRatio: 0, longestRunWords: 0, matches: [], verdict: 'clear' };
  }

  // Per source, the set of its shingles, so each draft window is one lookup.
  const bySource = sources.map((s) => ({
    source: s,
    shingles: shingleSet(
      tokenize(s.text).map((t) => t.word),
      n,
    ),
  }));

  // For each start index that begins a covered window, which source first carried it.
  const windowSource: (OverlapSourceText | null)[] = [];
  for (let i = 0; i + n <= words.length; i++) {
    const key = words.slice(i, i + n).join(' ');
    windowSource[i] = bySource.find((b) => b.shingles.has(key))?.source ?? null;
  }

  // A covered word is any word inside at least one covered window.
  const covered = new Array<boolean>(words.length).fill(false);
  for (let i = 0; i < windowSource.length; i++) {
    if (windowSource[i]) for (let j = i; j < i + n; j++) covered[j] = true;
  }

  // Merge covered words into runs; keep runs of at least `minRunWords`.
  const matches: OverlapMatch[] = [];
  let longestRunWords = 0;
  let coveredWordCount = 0;
  let runStart = -1;
  const flush = (endExclusive: number) => {
    if (runStart < 0) return;
    const length = endExclusive - runStart;
    coveredWordCount += length;
    if (length >= OVERLAP.minRunWords) {
      longestRunWords = Math.max(longestRunWords, length);
      const label = windowSource[runStart] ?? windowSource[Math.max(0, endExclusive - n)] ?? null;
      const from = tokens[runStart]?.start ?? 0;
      const to = tokens[endExclusive - 1]?.end ?? from;
      matches.push({
        sourceId: label?.sourceId ?? 'unknown',
        label: label?.label ?? 'a source',
        quote: passage.slice(from, to),
        wordCount: length,
      });
    }
    runStart = -1;
  };
  for (let i = 0; i < words.length; i++) {
    if (covered[i]) {
      if (runStart < 0) runStart = i;
    } else {
      flush(i);
    }
  }
  flush(words.length);

  const overlapRatio = words.length > 0 ? coveredWordCount / words.length : 0;
  const verdict: OverlapVerdict =
    overlapRatio >= OVERLAP.highAt ? 'high' : overlapRatio >= OVERLAP.reviewAt ? 'review' : 'clear';

  // Worst (longest) match first.
  matches.sort((a, b) => b.wordCount - a.wordCount);
  return { overlapRatio: Number(overlapRatio.toFixed(3)), longestRunWords, matches, verdict };
}

export interface SimilarityProvider {
  readonly name: string;
  report(passage: string, sources: readonly OverlapSourceText[]): OverlapReport;
}

/** The default read-only provider: word-shingle overlap against the thesis's own source texts. */
export class ShingleSimilarity implements SimilarityProvider {
  readonly name = 'shingle';
  report(passage: string, sources: readonly OverlapSourceText[]): OverlapReport {
    return overlapReport(passage, sources);
  }
}
