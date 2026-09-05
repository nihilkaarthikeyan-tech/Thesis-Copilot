/**
 * Gap analysis and the proposal skeleton — PRD FR-1.3 and FR-1.4.
 */

import { describe, expect, it } from 'vitest';
import { emptyExtraction, type PaperExtraction, paperExtractionSchema } from '../src/extraction.js';
import { analyseGap, draftScopeFrom } from '../src/gap.js';

const extraction = (over: Partial<PaperExtraction> = {}): PaperExtraction => ({
  ...emptyExtraction(),
  ...over,
});

const refs = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ raw: `[${i + 1}] Author ${i}. (2020). A paper.` }));

describe('analyseGap (FR-1.3)', () => {
  it('quantifies the reference gap in the PRD terms', () => {
    const gap = analyseGap(extraction({ references: refs(12) }));

    expect(gap.referenceCount).toBe(12);
    expect(gap.referenceTarget).toEqual({ min: 40, max: 60 });
    expect(gap.referenceGap).toBe(28);
    const item = gap.items.find((i) => i.id === 'reference-count');
    expect(item?.present).toBe(false);
    // The PRD's own example wording: "12 cited; thesis-length review typically 40–60".
    expect(item?.detail).toContain('12 cited');
    expect(item?.detail).toContain('40–60');
  });

  it('reports no gap when the paper already cites enough', () => {
    const gap = analyseGap(extraction({ references: refs(45) }));
    expect(gap.referenceGap).toBe(0);
    expect(gap.items.find((i) => i.id === 'reference-count')?.present).toBe(true);
  });

  it('lists the four things a thesis needs that a paper usually lacks', () => {
    const gap = analyseGap(extraction());
    expect(gap.items.map((i) => i.id)).toEqual([
      'literature-review',
      'methodology-justification',
      'limitations',
      'future-work',
      'reference-count',
    ]);
    // A bare paper has none of them.
    expect(gap.items.filter((i) => i.present)).toHaveLength(0);
  });

  it('marks an item present when the paper has that section, and says to expand it', () => {
    const gap = analyseGap(
      extraction({
        sections: [
          { heading: '2. Related Work', summary: 'Reviews prior studies.' },
          { heading: '3. Methodology', summary: 'Describes the survey.' },
        ],
      }),
    );

    const review = gap.items.find((i) => i.id === 'literature-review');
    expect(review?.present).toBe(true);
    expect(review?.detail).toContain('2. Related Work');
    expect(review?.detail).toContain('Expand it to thesis length');

    expect(gap.items.find((i) => i.id === 'methodology-justification')?.present).toBe(true);
    // Not mentioned anywhere, so still missing.
    expect(gap.items.find((i) => i.id === 'limitations')?.present).toBe(false);
  });

  it('finds a signal in a section summary, not only in a heading', () => {
    const gap = analyseGap(
      extraction({
        sections: [{ heading: '5. Discussion', summary: 'We note the limitations of the sample.' }],
      }),
    );
    expect(gap.items.find((i) => i.id === 'limitations')?.present).toBe(true);
  });

  it('explains what is missing rather than only saying it is missing', () => {
    const gap = analyseGap(extraction());
    for (const item of gap.items) {
      expect(item.detail.length).toBeGreaterThan(20);
    }
    expect(gap.items.find((i) => i.id === 'methodology-justification')?.detail).toContain(
      'justify',
    );
  });
});

describe('draftScopeFrom (FR-1.4)', () => {
  it('pre-fills the skeleton from the extraction', () => {
    const scope = draftScopeFrom(
      extraction({
        title: 'Solar adoption in rural Karnataka',
        abstract:
          'We survey 312 households. Cost is the leading barrier. Awareness was already high. A fourth sentence follows.',
        objectives: ['Measure adoption', 'Compare districts'],
      }),
    );

    expect(scope.workingTitle).toBe('Solar adoption in rural Karnataka');
    // FR-1.4 asks for a 2–3 sentence problem statement.
    expect(scope.problemStatement).toBe(
      'We survey 312 households. Cost is the leading barrier. Awareness was already high.',
    );
    expect(scope.objectives).toEqual(['Measure adoption', 'Compare districts']);
    // The student writes this one; nothing is invented for them.
    expect(scope.whyOpen).toBe('');
  });

  it('copes with an empty extraction', () => {
    const scope = draftScopeFrom(extraction());
    expect(scope).toEqual({ workingTitle: '', problemStatement: '', objectives: [], whyOpen: '' });
  });

  it('uses the whole abstract when it is shorter than three sentences', () => {
    const scope = draftScopeFrom(extraction({ abstract: 'One short abstract.' }));
    expect(scope.problemStatement).toBe('One short abstract.');
  });
});

describe('paperExtractionSchema (§10.7.1)', () => {
  it('accepts a full extraction and defaults the arrays', () => {
    const parsed = paperExtractionSchema.parse({
      title: 'A title',
      abstract: 'An abstract',
      methodology: 'A method',
    });
    expect(parsed.objectives).toEqual([]);
    expect(parsed.references).toEqual([]);
  });

  it('rejects a reference with no raw string', () => {
    expect(() =>
      paperExtractionSchema.parse({
        title: 't',
        abstract: 'a',
        methodology: 'm',
        references: [{ raw: '' }],
      }),
    ).toThrow();
  });

  it('rejects a non-string title', () => {
    expect(() =>
      paperExtractionSchema.parse({ title: 42, abstract: 'a', methodology: 'm' }),
    ).toThrow();
  });
});
