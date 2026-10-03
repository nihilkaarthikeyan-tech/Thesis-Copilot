/**
 * Gap-map relevance signal — ADR-0041. Turns the numbers the literature search already measured
 * (each candidate's cosine similarity to the thesis scope, and its OpenAlex citation count) into a
 * per-theme reading of *where the open gaps are*: which themes are relevant to the thesis yet
 * thinly covered, versus relevant and already busy, versus loosely related.
 *
 * Everything here is arithmetic over observed numbers. No model, no network, no metered unit, no
 * invention: a theme's relevance is the mean of similarities a model actually produced, and its
 * coverage is counted papers and their real citation counts. The classification is a heuristic for
 * the student to read, never a claim of fact about the field — the labels say "looks like", and the
 * UI shows the raw numbers beside them.
 */

/** One candidate paper as the search stored it: its similarity to the scope and its citedness. */
export type GapCandidate = {
  /** Cosine similarity of the paper to the thesis scope, as the discover run computed it. */
  score: number | null;
  /** OpenAlex citation count, when known. */
  citationCount: number | null;
};

export type GapTheme = {
  name: string;
  candidates: readonly GapCandidate[];
  /** How many of this theme's papers are in the library, when the living gap map is tracking it. */
  libraryCount?: number;
};

/**
 * - `open`     — relevant to the thesis but thinly covered: the gaps worth pursuing.
 * - `active`   — relevant and already well covered: a live conversation to join.
 * - `crowded`  — much literature, only loosely related: narrow before citing.
 * - `peripheral` — little literature and loosely related.
 * - `sparse`   — too few papers to read a relevance from; could be a true gap or a dead end.
 */
export type GapClass = 'open' | 'active' | 'crowded' | 'peripheral' | 'sparse';

export type GapSignal = {
  name: string;
  /** Mean similarity of this theme's papers to the scope, 0–1 (not normalised): the display value. */
  relevance: number;
  /** Relevance placed against the other themes in the run, 0–1: 1 is the most relevant theme. */
  relevanceRank: number;
  /** Counted volume and citedness of the theme against the run, 0–1: 1 is the best-covered theme. */
  coverage: number;
  /** Median citation count of the theme's papers, or null when none are known. */
  medianCitations: number | null;
  candidateCount: number;
  /** How open the gap looks: high relevance and low coverage. Sorts the map. */
  gapScore: number;
  gapClass: GapClass;
};

export const GAP_SIGNAL = {
  /** Below this many candidates a theme's mean relevance is not worth trusting. */
  minForRelevance: 2,
  /** Normalised relevance at or above this counts as "high" for the class. */
  relevanceHigh: 0.6,
  /** Normalised coverage at or above this counts as "well covered". */
  coverageHigh: 0.55,
  /** Volume's share of coverage; citedness is the remainder. */
  volumeWeight: 0.6,
} as const;

function median(values: number[]): number | null {
  const present = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (present.length === 0) return null;
  const mid = Math.floor(present.length / 2);
  return present.length % 2 === 0
    ? ((present[mid - 1] ?? 0) + (present[mid] ?? 0)) / 2
    : (present[mid] ?? 0);
}

/** Mean of the candidates' similarities, treating a missing score and a negative one as 0. */
function meanRelevance(candidates: readonly GapCandidate[]): number {
  const scored = candidates.map((c) => (typeof c.score === 'number' ? Math.max(0, c.score) : 0));
  if (scored.length === 0) return 0;
  return scored.reduce((a, b) => a + b, 0) / scored.length;
}

/** Min–max to 0–1 across the run; 0.5 for everything when the values do not spread. */
function spread(values: number[]): (value: number) => number {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max - min < 1e-9) return () => 0.5;
  return (value) => (value - min) / (max - min);
}

function classify(relevanceRank: number, coverage: number, candidateCount: number): GapClass {
  if (candidateCount < GAP_SIGNAL.minForRelevance) return 'sparse';
  const relevant = relevanceRank >= GAP_SIGNAL.relevanceHigh;
  const covered = coverage >= GAP_SIGNAL.coverageHigh;
  if (relevant && !covered) return 'open';
  if (relevant && covered) return 'active';
  if (covered) return 'crowded';
  return 'peripheral';
}

/**
 * Reads the gap signal for every theme in a run. Relevance and coverage are ranked *within the
 * run* so "high" and "low" mean something a student can act on ("this theme is my most relevant and
 * least covered"), rather than against an absolute cosine value that varies with the embedding
 * model. Returned most-open-gap first.
 */
export function gapSignals(themes: readonly GapTheme[]): GapSignal[] {
  if (themes.length === 0) return [];

  const base = themes.map((theme) => {
    const candidates = theme.candidates;
    const cites = candidates
      .map((c) => c.citationCount)
      .filter((n): n is number => typeof n === 'number');
    return {
      name: theme.name,
      candidateCount: candidates.length,
      relevance: meanRelevance(candidates),
      medianCitations: median(cites),
      // Coverage's volume half: how much the student kept, when curating has started, else found.
      volume: theme.libraryCount ?? candidates.length,
      maturity: median(cites) ?? 0,
    };
  });

  const rankRelevance = spread(base.map((b) => b.relevance));
  const rankVolume = spread(base.map((b) => b.volume));
  const rankMaturity = spread(base.map((b) => b.maturity));

  return base
    .map((b) => {
      const relevanceRank = rankRelevance(b.relevance);
      const coverage =
        GAP_SIGNAL.volumeWeight * rankVolume(b.volume) +
        (1 - GAP_SIGNAL.volumeWeight) * rankMaturity(b.maturity);
      const gapClass = classify(relevanceRank, coverage, b.candidateCount);
      // An "open" gap is relevant and under-covered; the score ranks those first.
      const gapScore =
        b.candidateCount < GAP_SIGNAL.minForRelevance ? 0 : relevanceRank * (1 - coverage);
      return {
        name: b.name,
        relevance: Number(b.relevance.toFixed(3)),
        relevanceRank: Number(relevanceRank.toFixed(3)),
        coverage: Number(coverage.toFixed(3)),
        medianCitations: b.medianCitations,
        candidateCount: b.candidateCount,
        gapScore: Number(gapScore.toFixed(3)),
        gapClass,
      };
    })
    .sort((a, b) => b.gapScore - a.gapScore);
}
