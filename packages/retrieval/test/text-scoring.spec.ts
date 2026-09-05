/**
 * Normalisation, similarity and the Appendix C.3 scoring rules.
 * The scoring run against the real fixture papers lives in `extraction.spec.ts`.
 */

import { describe, expect, it } from 'vitest';
import { C3_THRESHOLDS, formatScoreTable, matchReferences, scorePaper } from '../src/scoring.js';
import {
  jaccard,
  levenshtein,
  normalise,
  normaliseReference,
  similarity,
  splitSentences,
  stripReferenceNumbering,
} from '../src/text.js';

describe('normalise (C.3 title rule)', () => {
  it('applies NFKC, collapses whitespace and case-folds', () => {
    expect(normalise('  Deep   Learning\nFor   Vision ')).toBe('deep learning for vision');
    // NFKC folds the ligature and the full-width letters.
    expect(normalise('ﬁnite')).toBe('finite');
    expect(normalise('ＡＢＣ')).toBe('abc');
  });

  it('folds the quotes and dashes PDF extractors emit', () => {
    expect(normalise('“Smart” cities—a review')).toBe(normalise('"Smart" cities-a review'));
    expect(normalise("students' work")).toBe(normalise('students’ work'));
  });

  it('folds a non-breaking space', () => {
    expect(normalise('a b')).toBe('a b');
  });
});

describe('reference numbering', () => {
  it.each([
    ['[12] Kumar, A. (2021). Title.', 'Kumar, A. (2021). Title.'],
    ['12. Kumar, A. (2021). Title.', 'Kumar, A. (2021). Title.'],
    ['(3) Kumar, A. (2021). Title.', 'Kumar, A. (2021). Title.'],
    ['Kumar, A. (2021). Title.', 'Kumar, A. (2021). Title.'],
  ])('strips %s', (input, expected) => {
    expect(stripReferenceNumbering(input)).toBe(expected);
  });

  it('makes two numbering styles of one reference compare equal', () => {
    expect(normaliseReference('[7] Rao, B. Adoption. 2019.')).toBe(
      normaliseReference('7. Rao, B. Adoption. 2019.'),
    );
  });
});

describe('similarity', () => {
  it('levenshtein counts single edits', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('same', 'same')).toBe(0);
  });

  it('similarity is 1 for identical and 0 for wholly different', () => {
    expect(similarity('abc', 'abc')).toBe(1);
    expect(similarity('', '')).toBe(1);
    expect(similarity('abc', 'xyz')).toBe(0);
  });

  it('clears the 0.85 reference bar for a realistic OCR wobble', () => {
    const a =
      'Kumar, A., & Rao, B. (2021). Solar adoption in rural Karnataka. Energy Policy, 152, 112.';
    const b =
      'Kumar, A., and Rao, B. (2021). Solar adoption in rural Karnataka. Energy Policy, 152, 112.';
    expect(similarity(normaliseReference(a), normaliseReference(b))).toBeGreaterThan(0.85);
  });

  it('stays below the bar for two different papers by the same authors', () => {
    const a = 'Kumar, A., & Rao, B. (2021). Solar adoption in rural Karnataka. Energy Policy.';
    const b =
      'Kumar, A., & Rao, B. (2019). Wind turbine siting in coastal Kerala. Renewable Energy.';
    expect(similarity(normaliseReference(a), normaliseReference(b))).toBeLessThan(0.85);
  });
});

describe('jaccard (C.3 abstract rule)', () => {
  it('is 1 for the same token set regardless of order or punctuation', () => {
    expect(jaccard('the cat sat', 'sat, the cat!')).toBe(1);
  });

  it('is 1 for two empty strings and 0 for no overlap', () => {
    expect(jaccard('', '')).toBe(1);
    expect(jaccard('alpha beta', 'gamma delta')).toBe(0);
  });

  it('clears 0.90 when only a stray extraction artefact differs', () => {
    const expected = 'We study solar adoption across three districts and report the main barriers.';
    const actual = 'We study solar adoption across three districts and report the main barriers';
    expect(jaccard(actual, expected)).toBeGreaterThanOrEqual(C3_THRESHOLDS.abstractJaccard);
  });
});

describe('splitSentences', () => {
  it('splits on terminators and keeps offsets', () => {
    const text = 'First one. Second one! Third one?';
    const sentences = splitSentences(text);
    expect(sentences.map((s) => s.text.trim())).toEqual([
      'First one.',
      'Second one!',
      'Third one?',
    ]);
    for (const sentence of sentences) {
      expect(text.slice(sentence.start, sentence.end)).toBe(sentence.text);
    }
  });

  it('does not split on "et al." or initials', () => {
    const text = 'As Kumar et al. showed, the rate rose. A second sentence follows.';
    expect(splitSentences(text)).toHaveLength(2);
  });

  it('does not split inside a decimal', () => {
    expect(splitSentences('The mean was 3.5 units overall. Then it fell.')).toHaveLength(2);
  });

  it('does not split on e.g. or i.e.', () => {
    expect(
      splitSentences('Some sources, e.g. reviews, were excluded. Others stayed.'),
    ).toHaveLength(2);
  });

  it('handles a trailing fragment with no terminator', () => {
    const sentences = splitSentences('Complete one. Trailing fragment');
    expect(sentences).toHaveLength(2);
    expect(sentences[1]?.text.trim()).toBe('Trailing fragment');
  });

  it('returns nothing for empty input', () => {
    expect(splitSentences('')).toEqual([]);
    expect(splitSentences('   ')).toEqual([]);
  });
});

describe('matchReferences', () => {
  const expected = [
    'Kumar, A. (2021). Solar adoption in rural Karnataka. Energy Policy.',
    'Rao, B. (2019). Wind siting in coastal Kerala. Renewable Energy.',
    'Singh, C. (2020). Grid stability under load. IEEE Trans.',
  ];

  it('matches each captured string to at most one expected string', () => {
    const captured = [
      '[1] Kumar, A. (2021). Solar adoption in rural Karnataka. Energy Policy.',
      '[2] Kumar, A. (2021). Solar adoption in rural Karnataka. Energy Policy.',
    ];
    const { pairs } = matchReferences(captured, expected);
    // Two identical captures cannot both claim the one expected entry.
    expect(pairs).toHaveLength(1);
  });

  it('reports captured strings that match nothing', () => {
    const captured = [
      '[1] Kumar, A. (2021). Solar adoption in rural Karnataka. Energy Policy.',
      'Figure 3: results',
    ];
    const { pairs, unmatchedCaptured } = matchReferences(captured, expected);
    expect(pairs).toHaveLength(1);
    expect(unmatchedCaptured).toEqual([1]);
  });
});

describe('scorePaper (C.3)', () => {
  const expected = {
    title: 'Solar adoption in rural Karnataka',
    abstract: 'We survey 312 households and report cost as the leading barrier to adoption.',
    references: [
      { raw: 'Kumar, A. (2021). Solar adoption. Energy Policy.', doi: '10.1/aaa', crossref: true },
      { raw: 'Rao, B. (2019). Wind siting. Renewable Energy.', doi: '10.1/bbb', crossref: true },
      { raw: 'Singh, C. (2020). Grid stability. IEEE Trans.', doi: null, crossref: false },
    ],
  };

  it('passes a clean extraction', () => {
    const score = scorePaper(
      'p01',
      {
        title: 'Solar  Adoption in Rural Karnataka',
        abstract: 'We survey 312 households and report cost as the leading barrier to adoption.',
        references: expected.references.map((r) => r.raw),
        resolvedDois: {
          [expected.references[0]?.raw ?? '']: '10.1/AAA',
          [expected.references[1]?.raw ?? '']: 'https://doi.org/10.1/bbb',
        },
      },
      expected,
    );

    expect(score.titleExact).toBe(true);
    expect(score.abstractJaccard).toBe(1);
    expect(score.referenceRecall).toBe(1);
    expect(score.referencePrecision).toBe(0);
    // DOIs compare case-insensitively and with the doi.org prefix stripped.
    expect(score.doiResolution).toBe(1);
    expect(score.passes).toBe(true);
  });

  it('fails and says why when the title differs and references are missed', () => {
    const score = scorePaper(
      'p02',
      {
        title: 'A different title entirely',
        abstract: 'Something else about turbines and coastal wind resource assessment methods.',
        references: [expected.references[0]?.raw ?? '', 'Figure 2: study area'],
      },
      expected,
    );

    expect(score.passes).toBe(false);
    expect(score.failures.join(' ')).toContain('title not exact');
    expect(score.failures.join(' ')).toContain('abstract Jaccard');
    expect(score.failures.join(' ')).toContain('reference recall');
    expect(score.failures.join(' ')).toContain('reference precision');
    expect(score.doiResolution).toBe(0);
  });

  it('reports no DOI figure when the human marked none as findable', () => {
    const score = scorePaper(
      'p03',
      {
        title: expected.title,
        abstract: expected.abstract,
        references: expected.references.map((r) => r.raw),
      },
      { ...expected, references: expected.references.map((r) => ({ ...r, crossref: false })) },
    );
    expect(score.doiResolution).toBeNull();
  });

  it('renders the per-paper table C.3 asks for', () => {
    const table = formatScoreTable([
      scorePaper(
        'p01',
        {
          title: expected.title,
          abstract: expected.abstract,
          references: expected.references.map((r) => r.raw),
        },
        expected,
      ),
    ]);
    expect(table).toContain('| paper | title | abstract J |');
    expect(table).toContain('p01');
  });
});
