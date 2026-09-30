/**
 * The pre-submission citation report: five existing checks on one page.
 *
 * What is worth pinning is the judgement — what counts as "fix before anyone reads it", what is
 * left out as a duplicate, and that a support flag whose chapter has since changed does not send
 * the student to the wrong sentence.
 */

import { describe, expect, it } from 'vitest';
import {
  buildCitationReport,
  chapterDensity,
  isReviewChapter,
  type ReportInput,
} from '../src/modules/citation-report/citation-report.js';
import type { FlagView } from '../src/modules/coherence/coherence.service.js';

const flag = (over: Partial<FlagView>): FlagView => ({
  id: 'f1',
  chapterId: 'ch1',
  chapterTitle: 'Introduction',
  relatedChapterId: null,
  relatedChapterTitle: null,
  type: 'CITATION_SUPPORT',
  severity: 'ERROR',
  description: 'The passage reports a fall, not a rise.',
  from: 10,
  to: 40,
  status: 'OPEN',
  ignoreReason: null,
  createdAt: '2026-09-25T00:00:00.000Z',
  positionTrusted: true,
  ...over,
});

const empty: ReportInput = {
  citations: { findings: [], counts: { citations: 4, sources: 3 } },
  health: [],
  depth: { atRisk: [], unread: [] },
  flags: { flags: [], lastRunAt: null },
};

describe('the citation report', () => {
  it('says so plainly when there is nothing to fix', () => {
    const report = buildCitationReport(empty);
    expect(report.items).toEqual([]);
    expect(report.headline).toBe('No citation problems found.');
    expect(report.citations).toBe(4);
    // And that the support check has never run, so "nothing" is not the whole answer.
    expect(report.supportCheck.lastRunAt).toBeNull();
  });

  it('puts what must be fixed first, whichever check found it', () => {
    const report = buildCitationReport({
      ...empty,
      citations: {
        findings: [
          { kind: 'UNUSED', message: 'Never cited.', sourceId: 's9' },
          {
            kind: 'ORPHAN',
            message: 'No source.',
            chapterId: 'ch2',
            chapterTitle: 'Method',
            from: 5,
            to: 6,
          },
        ],
        counts: { citations: 4, sources: 3 },
      },
      health: [
        {
          kind: 'RETRACTED',
          sourceId: 's1',
          shortRef: 'Rao 2019',
          title: 'A paper',
          message: 'Retracted in 2022.',
          severity: 'high',
        },
      ],
      depth: {
        atRisk: [],
        unread: [
          {
            sourceId: 's2',
            shortRef: 'Iyer 2020',
            title: null,
            groundingLevel: 'NONE',
            citeCount: 2,
          },
        ],
      },
      flags: { flags: [flag({})], lastRunAt: '2026-09-25T00:00:00.000Z' },
    });

    expect(report.items.map((item) => item.kind)).toEqual([
      'ORPHAN',
      'CITATION_SUPPORT',
      'RETRACTED',
      'UNREAD',
      'UNUSED',
    ]);
    expect(report.counts).toEqual({ high: 3, medium: 1, low: 1, total: 5 });
    expect(report.headline).toBe('3 to fix before anyone reads it, 1 worth fixing, 1 minor.');
    // The mechanical finding keeps its position: the editor can select it.
    expect(report.items[0]).toMatchObject({ chapterId: 'ch2', from: 5, to: 6 });
    expect(report.items[3]?.message).toContain('Iyer 2020 2 times');
  });

  it('leaves out the run’s integrity flags, which are the live checks as they were', () => {
    const report = buildCitationReport({
      ...empty,
      flags: {
        flags: [flag({ id: 'old', type: 'CITATION_INTEGRITY' }), flag({ type: 'TERMINOLOGY' })],
        lastRunAt: '2026-09-25T00:00:00.000Z',
      },
    });
    expect(report.items).toEqual([]);
  });

  it('keeps an ignored or resolved flag out', () => {
    const report = buildCitationReport({
      ...empty,
      flags: { flags: [flag({ status: 'IGNORED' })], lastRunAt: '2026-09-25T00:00:00.000Z' },
    });
    expect(report.items).toEqual([]);
  });

  it('drops the position of a flag whose chapter changed, and says the check is out of date', () => {
    const report = buildCitationReport({
      ...empty,
      flags: {
        flags: [flag({ positionTrusted: false, severity: 'WARN' })],
        lastRunAt: '2026-09-25T00:00:00.000Z',
      },
    });
    const [item] = report.items;
    expect(item?.title).toBe('Claims more than the source');
    expect(item?.chapterId).toBe('ch1');
    expect(item?.from).toBeUndefined();
    expect(report.supportCheck.outOfDate).toBe(true);
  });

  it('names an uncited claim for what it is', () => {
    const report = buildCitationReport({
      ...empty,
      flags: {
        flags: [flag({ type: 'UNSUPPORTED_CLAIM', severity: 'WARN' })],
        lastRunAt: '2026-09-25T00:00:00.000Z',
      },
    });
    expect(report.items[0]).toMatchObject({
      title: 'A claim with no citation',
      severity: 'medium',
    });
  });
});

/**
 * 2026-09-30: a reviewer's comparison with Jenni found our Literature Review cited nothing. The
 * report now says when a chapter that reviews prior work has paragraphs that cite nothing.
 */
describe('citation density in a review chapter', () => {
  const sentence =
    'Electrode wear in the machining of nickel superalloys depends on the electrode material and the discharge energy used.';
  const para = (cited: boolean) => ({
    type: 'paragraph',
    content: [
      { type: 'text', text: `${sentence} ${sentence} ${sentence}` },
      ...(cited ? [{ type: 'citation', attrs: { key: 'k' } }] : []),
    ],
  });
  const doc = (...cited: boolean[]) => ({ type: 'doc', content: cited.map(para) });

  it('flags a literature review where most paragraphs cite nothing', () => {
    const chapters = [
      chapterDensity({ id: 'c2', title: 'Literature Review', content: doc(false, false, true) }),
    ];
    const report = buildCitationReport({ ...empty, chapters });
    const item = report.items.find((i) => i.kind === 'THIN_REVIEW');
    expect(item).toMatchObject({ severity: 'medium', chapterId: 'c2', check: 'density' });
    expect(item?.message).toContain('2 of its 3 paragraphs cite nothing');
  });

  it('leaves a well-cited review, and a chapter that is not a review, alone', () => {
    const chapters = [
      chapterDensity({ id: 'c2', title: 'Literature Review', content: doc(true, true, false) }),
      chapterDensity({ id: 'c3', title: 'Methodology', content: doc(false, false, false) }),
    ];
    const report = buildCitationReport({ ...empty, chapters });
    expect(report.items.filter((i) => i.kind === 'THIN_REVIEW')).toHaveLength(0);
  });

  it('knows a review chapter by its title', () => {
    expect(isReviewChapter('Chapter 2: Review of related work')).toBe(true);
    expect(isReviewChapter('Theoretical framework')).toBe(true);
    expect(isReviewChapter('Results and discussion')).toBe(false);
  });
});
