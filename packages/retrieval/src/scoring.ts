/**
 * Extraction scoring — PRD Appendix C.3, run by `test/extraction.spec.ts`.
 *
 * | Field                | Rule                                                    | Threshold |
 * |----------------------|---------------------------------------------------------|-----------|
 * | title                | equal after NFKC + whitespace collapse + case-fold       | 5/5       |
 * | abstract             | token-set overlap (Jaccard) ≥ 0.90                       | 5/5       |
 * | references recall    | match if normalised Levenshtein similarity ≥ 0.85        | ≥ 0.90    |
 * | references precision | captured strings matching nothing expected               | ≤ 0.05    |
 * | DOI resolution       | of expected refs marked `"crossref": true`, correct DOI  | ≥ 0.80    |
 *
 * The agent never writes `*.expected.json` (§0.3 rule 3); this only reads them.
 */

import { jaccard, normalise, referenceSimilarity } from './text.js';

export const REFERENCE_MATCH_THRESHOLD = 0.85;

export const C3_THRESHOLDS = {
  abstractJaccard: 0.9,
  referenceRecall: 0.9,
  referencePrecision: 0.05,
  doiResolution: 0.8,
} as const;

/** One reference as the human corrected it in `pNN.expected.json`. */
export type ExpectedReference = {
  raw: string;
  doi?: string | null;
  /** The human marks references whose DOI is findable in Crossref (C.3 DOI-resolution rule). */
  crossref?: boolean;
};

export type ExpectedExtraction = {
  title: string;
  abstract: string;
  references: ReadonlyArray<ExpectedReference | string>;
};

/** What the pipeline produced for one paper. */
export type ActualExtraction = {
  title: string;
  abstract: string;
  references: readonly string[];
  /** Raw reference string → the DOI the resolver settled on, if any. */
  resolvedDois?: Readonly<Record<string, string | null>>;
};

export type PaperScore = {
  paper: string;
  titleExact: boolean;
  abstractJaccard: number;
  referenceRecall: number;
  referencePrecision: number;
  /** Fraction of `crossref: true` references whose DOI the resolver got right; null if none marked. */
  doiResolution: number | null;
  expectedReferences: number;
  capturedReferences: number;
  matchedReferences: number;
  passes: boolean;
  failures: string[];
};

function expectedRaw(reference: ExpectedReference | string): string {
  return typeof reference === 'string' ? reference : reference.raw;
}

function normaliseDoi(doi: string | null | undefined): string | null {
  if (!doi) return null;
  return doi
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
    .replace(/^doi:\s*/, '');
}

/**
 * Greedy one-to-one matching between captured and expected references: each captured string takes
 * its best unused expected partner above the threshold. One-to-one matters because a paper often
 * cites the same authors twice, and a lazy many-to-one match would inflate recall.
 */
export function matchReferences(
  captured: readonly string[],
  expected: ReadonlyArray<ExpectedReference | string>,
): {
  pairs: Array<{ capturedIndex: number; expectedIndex: number; score: number }>;
  unmatchedCaptured: number[];
} {
  const scored: Array<{ capturedIndex: number; expectedIndex: number; score: number }> = [];

  for (let c = 0; c < captured.length; c++) {
    for (let e = 0; e < expected.length; e++) {
      const score = referenceSimilarity(captured[c] ?? '', expectedRaw(expected[e] ?? ''));
      if (score >= REFERENCE_MATCH_THRESHOLD)
        scored.push({ capturedIndex: c, expectedIndex: e, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const usedCaptured = new Set<number>();
  const usedExpected = new Set<number>();
  const pairs: typeof scored = [];

  for (const candidate of scored) {
    if (usedCaptured.has(candidate.capturedIndex) || usedExpected.has(candidate.expectedIndex))
      continue;
    usedCaptured.add(candidate.capturedIndex);
    usedExpected.add(candidate.expectedIndex);
    pairs.push(candidate);
  }

  const unmatchedCaptured = captured
    .map((_, index) => index)
    .filter((index) => !usedCaptured.has(index));

  return { pairs, unmatchedCaptured };
}

export function scorePaper(
  paper: string,
  actual: ActualExtraction,
  expected: ExpectedExtraction,
): PaperScore {
  const titleExact = normalise(actual.title) === normalise(expected.title);
  const abstractJaccard = jaccard(actual.abstract, expected.abstract);

  const { pairs, unmatchedCaptured } = matchReferences(actual.references, expected.references);
  const expectedCount = expected.references.length;
  const capturedCount = actual.references.length;
  const referenceRecall = expectedCount === 0 ? 1 : pairs.length / expectedCount;
  const referencePrecision = capturedCount === 0 ? 0 : unmatchedCaptured.length / capturedCount;

  // DOI resolution over the references the human marked as findable in Crossref.
  const crossrefExpected = expected.references
    .map((reference, index) => ({ reference, index }))
    .filter(({ reference }) => typeof reference !== 'string' && reference.crossref === true);

  let doiResolution: number | null = null;
  if (crossrefExpected.length > 0) {
    const byExpectedIndex = new Map(pairs.map((p) => [p.expectedIndex, p.capturedIndex]));
    let correct = 0;
    for (const { reference, index } of crossrefExpected) {
      const capturedIndex = byExpectedIndex.get(index);
      if (capturedIndex === undefined) continue;
      const capturedRaw = actual.references[capturedIndex] ?? '';
      const got = normaliseDoi(actual.resolvedDois?.[capturedRaw]);
      const want = normaliseDoi(typeof reference === 'string' ? null : reference.doi);
      if (got && want && got === want) correct++;
    }
    doiResolution = correct / crossrefExpected.length;
  }

  const failures: string[] = [];
  if (!titleExact) failures.push('title not exact');
  if (abstractJaccard < C3_THRESHOLDS.abstractJaccard) {
    failures.push(
      `abstract Jaccard ${abstractJaccard.toFixed(3)} < ${C3_THRESHOLDS.abstractJaccard}`,
    );
  }
  if (referenceRecall < C3_THRESHOLDS.referenceRecall) {
    failures.push(
      `reference recall ${referenceRecall.toFixed(3)} < ${C3_THRESHOLDS.referenceRecall}`,
    );
  }
  if (referencePrecision > C3_THRESHOLDS.referencePrecision) {
    failures.push(
      `reference precision ${referencePrecision.toFixed(3)} > ${C3_THRESHOLDS.referencePrecision}`,
    );
  }
  if (doiResolution !== null && doiResolution < C3_THRESHOLDS.doiResolution) {
    failures.push(`DOI resolution ${doiResolution.toFixed(3)} < ${C3_THRESHOLDS.doiResolution}`);
  }

  return {
    paper,
    titleExact,
    abstractJaccard,
    referenceRecall,
    referencePrecision,
    doiResolution,
    expectedReferences: expectedCount,
    capturedReferences: capturedCount,
    matchedReferences: pairs.length,
    passes: failures.length === 0,
    failures,
  };
}

/** The per-paper table C.3 requires in the build log. */
export function formatScoreTable(scores: readonly PaperScore[]): string {
  const header =
    '| paper | title | abstract J | ref recall | ref prec | DOI res | refs (exp/cap/match) | pass |';
  const rule = `|${'-'.repeat(7)}|${'-'.repeat(7)}|${'-'.repeat(12)}|${'-'.repeat(12)}|${'-'.repeat(10)}|${'-'.repeat(9)}|${'-'.repeat(22)}|${'-'.repeat(6)}|`;
  const rows = scores.map((s) =>
    [
      '',
      s.paper.padEnd(5),
      (s.titleExact ? 'yes' : 'NO').padEnd(5),
      s.abstractJaccard.toFixed(3).padStart(10),
      s.referenceRecall.toFixed(3).padStart(10),
      s.referencePrecision.toFixed(3).padStart(8),
      (s.doiResolution === null ? '-' : s.doiResolution.toFixed(3)).padStart(7),
      `${s.expectedReferences}/${s.capturedReferences}/${s.matchedReferences}`.padStart(20),
      (s.passes ? 'PASS' : 'FAIL').padEnd(4),
      '',
    ].join(' | '),
  );
  const failures = scores.flatMap((s) => s.failures.map((f) => `  ${s.paper}: ${f}`));
  return [header, rule, ...rows, ...(failures.length ? ['', 'Failures:', ...failures] : [])].join(
    '\n',
  );
}
