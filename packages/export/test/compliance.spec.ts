/**
 * Compliance checks — PRD Appendix D.3.3, FR-8.1; PHASES v2 B3.2 and the VERIFY batch
 * ("compliance negatives").
 *
 * The negatives are the point. A checklist that passes a thesis it should have stopped is worse
 * than no checklist, because the student trusts it and hands the file in; and a check that fires
 * on a thesis that is fine trains them to override every one of them. So each check below is
 * tested twice — once on a document that should trip it, and once on the same document with only
 * that fault removed.
 *
 * The `.docx` is never blocked by any of this (§12.2); it is the PDF that waits, and the override
 * with a reason exists because a university's rule our checker misreads must not trap someone the
 * night before a deadline. That gate lives in `ThesisExportService`; this file is only the reading.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readTemplateSpec, readThesisDetails } from '@tc/types';
import { describe, expect, it } from 'vitest';
import {
  type CheckId,
  type ComplianceChapter,
  figuresOf,
  headingsOf,
  runComplianceChecks,
} from '../src/compliance.js';

// The EXAMPLE_IN_UNIVERSITY spec the seed installs, not `readTemplateSpec()`'s bare defaults:
// a spec with no front-matter sections passes every front-matter check, which would make half
// this file assert nothing.
const SPEC = readTemplateSpec(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../db/prisma/seed-data/example-template.json', import.meta.url)),
      'utf8',
    ),
  ),
);

const FULL_DETAILS = readThesisDetails({
  studentName: 'A. Kumar',
  rollNo: '21MT0345',
  degree: 'Master of Technology in Energy Systems',
  department: 'Mechanical Engineering',
  institution: 'Example Institute of Technology',
  guideName: 'Dr. S. Raman',
  guideDesignation: 'Associate Professor',
  hodName: 'Dr. P. Menon',
  monthYear: 'June 2027',
  abstract: 'This thesis designs and evaluates a low-cost forced-convection solar dryer. '.repeat(
    8,
  ),
  acknowledgements: 'Thanks to the department workshop.',
  abbreviations: { PV: 'Photovoltaic' },
  declarationDate: '2027-06-01',
});

const heading = (level: number, text: string) => ({
  type: 'heading',
  attrs: { level },
  content: [{ type: 'text', text }],
});
const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

/** A chapter long enough not to trip the word-count check on its own. */
const filler = () => para('The dryer was instrumented and run for three seasons. '.repeat(40));

function chapter(title: string, ...body: unknown[]): ComplianceChapter {
  return {
    id: title.toLowerCase().replace(/\W+/g, '-'),
    title,
    order: 1,
    content: { type: 'doc', content: [heading(1, title), ...body, filler()] },
  };
}

const CHAPTERS = [
  { ...chapter('Introduction', para('Coastal drying is open-air.')), order: 1 },
  {
    ...chapter('Methodology', heading(2, 'The rig'), para('A forced-convection dryer.')),
    order: 2,
  },
];

/** A document that passes everything the checker can see. */
const clean = () => ({
  spec: SPEC,
  details: FULL_DETAILS,
  documentTitle: 'Solar Drying of Coastal Catch',
  chapters: CHAPTERS,
  citations: { orphans: 0, bibliographyEntries: 12, style: SPEC.bibliography.style },
});

const findings = (result: ReturnType<typeof runComplianceChecks>, check: CheckId) =>
  result.findings.filter((f) => f.check === check);

const failed = (result: ReturnType<typeof runComplianceChecks>) =>
  result.checks.filter((c) => !c.passed).map((c) => c.check);

describe('the shape of the result', () => {
  it('reports every check, passing or not', () => {
    const result = runComplianceChecks(clean());
    expect(result.checks.map((c) => c.check).sort()).toEqual(
      [
        'ABSTRACT_LENGTH',
        'CHAPTER_HEADINGS',
        'CITATIONS',
        'FIGURES_TABLES',
        'FRONT_MATTER',
        'HEADING_NUMBERING',
        'PAGE_SETUP',
        'TITLE_PAGE_FIELDS',
        'TOC_CONSISTENCY',
        'WORD_COUNT',
      ].sort(),
    );
  });

  it('`findings` is the flat list of what every check found', () => {
    const result = runComplianceChecks({ ...clean(), details: readThesisDetails({}) });
    expect(result.findings).toEqual(result.checks.flatMap((c) => c.findings));
  });

  it('`passed` is true only when nothing was found', () => {
    expect(runComplianceChecks(clean()).passed).toBe(true);
    expect(runComplianceChecks({ ...clean(), details: readThesisDetails({}) }).passed).toBe(false);
  });

  it('every finding says what is wrong in a sentence a student can act on', () => {
    const result = runComplianceChecks({ ...clean(), details: readThesisDetails({}) });
    for (const finding of result.findings) {
      expect(finding.message.length, finding.check).toBeGreaterThan(20);
      expect(finding.message.trim().endsWith('.'), finding.message).toBe(true);
    }
  });
});

describe('1–2. front matter and title-page fields', () => {
  it('an empty details form fails both, naming each missing field', () => {
    const result = runComplianceChecks({ ...clean(), details: readThesisDetails({}) });
    expect(failed(result)).toContain('FRONT_MATTER');
    const names = findings(result, 'TITLE_PAGE_FIELDS')
      .map((f) => f.message)
      .join(' ');
    expect(names).toContain('studentName');
    expect(names).toContain('degree');
  });

  it('a filled form passes both', () => {
    const result = runComplianceChecks(clean());
    expect(failed(result)).not.toContain('FRONT_MATTER');
    expect(failed(result)).not.toContain('TITLE_PAGE_FIELDS');
  });

  it('names one field at a time, so the student fixes exactly what is missing', () => {
    const result = runComplianceChecks({
      ...clean(),
      details: readThesisDetails({ ...FULL_DETAILS, hodName: '   ' }),
    });
    const rows = findings(result, 'TITLE_PAGE_FIELDS');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.message).toContain('hodName');
  });
});

describe('3. abstract length', () => {
  const limit = SPEC.frontMatter.find((s) => s.id === 'ABSTRACT')?.maxWords;

  it('fails when the abstract is over the template limit, with both numbers', () => {
    if (!limit) return;
    const result = runComplianceChecks({
      ...clean(),
      details: readThesisDetails({ ...FULL_DETAILS, abstract: 'word '.repeat(limit + 50) }),
    });
    const message = findings(result, 'ABSTRACT_LENGTH')[0]?.message ?? '';
    expect(message).toContain(String(limit + 50));
    expect(message).toContain(String(limit));
  });

  it('passes at exactly the limit — a boundary a student will hit deliberately', () => {
    if (!limit) return;
    const result = runComplianceChecks({
      ...clean(),
      details: readThesisDetails({ ...FULL_DETAILS, abstract: 'word '.repeat(limit) }),
    });
    expect(failed(result)).not.toContain('ABSTRACT_LENGTH');
  });
});

describe('4. chapter headings', () => {
  it('fails a chapter with no level-1 heading', () => {
    const result = runComplianceChecks({
      ...clean(),
      chapters: [
        {
          id: 'c',
          title: 'Introduction',
          order: 1,
          content: { type: 'doc', content: [para('No heading.')] },
        },
      ],
    });
    expect(findings(result, 'CHAPTER_HEADINGS')[0]?.message).toContain('no level-1 heading');
  });

  it('fails a chapter with two, and says how many', () => {
    const result = runComplianceChecks({
      ...clean(),
      chapters: [
        {
          id: 'c',
          title: 'Introduction',
          order: 1,
          content: { type: 'doc', content: [heading(1, 'Introduction'), heading(1, 'Also this')] },
        },
      ],
    });
    expect(findings(result, 'CHAPTER_HEADINGS')[0]?.message).toContain('2 level-1 headings');
  });

  it('names the chapter, so the student knows which one to open', () => {
    const result = runComplianceChecks({
      ...clean(),
      chapters: [
        { id: 'c', title: 'Methodology', order: 1, content: { type: 'doc', content: [] } },
      ],
    });
    expect(findings(result, 'CHAPTER_HEADINGS')[0]?.chapterTitle).toBe('Methodology');
  });
});

describe('5. heading numbering', () => {
  it('fails when a level is skipped', () => {
    const result = runComplianceChecks({
      ...clean(),
      chapters: [
        {
          id: 'c',
          title: 'Introduction',
          order: 1,
          content: { type: 'doc', content: [heading(1, 'Introduction'), heading(3, 'Deep')] },
        },
      ],
    });
    const message = findings(result, 'HEADING_NUMBERING')[0]?.message ?? '';
    expect(message).toContain('Deep');
    expect(message).toContain('level is missing');
  });

  it('passes a well-nested chapter, and passes going back up a level', () => {
    const result = runComplianceChecks({
      ...clean(),
      chapters: [
        {
          id: 'c',
          title: 'Introduction',
          order: 1,
          content: {
            type: 'doc',
            content: [
              heading(1, 'Introduction'),
              heading(2, 'Background'),
              heading(3, 'History'),
              heading(2, 'Objectives'),
              filler(),
            ],
          },
        },
      ],
    });
    expect(failed(result)).not.toContain('HEADING_NUMBERING');
  });
});

describe('6. figures and tables', () => {
  /** A caption is the adjacent paragraph beginning "Figure"/"Table", as it is in a thesis. */
  const withFigure = (caption: string | null, mention: string) => ({
    ...clean(),
    chapters: [
      {
        id: 'c',
        title: 'Results',
        order: 1,
        content: {
          type: 'doc',
          content: [
            heading(1, 'Results'),
            { type: 'image', attrs: { alt: 'Drying curve' } },
            ...(caption ? [para(caption)] : []),
            para(mention),
            filler(),
          ],
        },
      },
    ],
  });

  it('fails an uncaptioned figure', () => {
    const result = runComplianceChecks(withFigure(null, 'See Figure 1 for the drying curve.'));
    expect(findings(result, 'FIGURES_TABLES').map((f) => f.message)).toContain(
      'A figure has no caption.',
    );
  });

  it('fails a figure the text never refers to — the check a student most often needs', () => {
    const result = runComplianceChecks(
      withFigure('Figure 1.1: Drying curve', 'The dryer worked well.'),
    );
    const message = findings(result, 'FIGURES_TABLES')[0]?.message ?? '';
    expect(message).toContain('never referred to');
  });

  it('passes a captioned figure the text refers to', () => {
    const result = runComplianceChecks(
      withFigure('Figure 1.1: Drying curve', 'Figure 1 shows the curve.'),
    );
    expect(failed(result)).not.toContain('FIGURES_TABLES');
  });

  it('accepts either numbering convention in the reference', () => {
    for (const mention of ['Figure 1 shows the curve.', 'Figure 1.1 shows the curve.']) {
      const result = runComplianceChecks(withFigure('Figure 1.1: Drying curve', mention));
      expect(failed(result), mention).not.toContain('FIGURES_TABLES');
    }
  });

  it('a sentence that legitimately opens with "Figure 1 …" still counts as a reference', () => {
    // The caption is removed by matching the exact string `figuresOf` found, not by a rule about
    // paragraphs that start with "Figure" — which would eat this sentence too.
    const result = runComplianceChecks(
      withFigure('Figure 1.1: Drying curve', 'Figure 1 shows a two-stage fall in moisture.'),
    );
    expect(failed(result)).not.toContain('FIGURES_TABLES');
  });
});

describe('7. contents consistency', () => {
  it("fails when the chapter's own heading and its title disagree", () => {
    const result = runComplianceChecks({
      ...clean(),
      chapters: [
        {
          id: 'c',
          title: 'Introduction',
          order: 1,
          content: { type: 'doc', content: [heading(1, 'Background and motivation'), filler()] },
        },
      ],
    });
    const message = findings(result, 'TOC_CONSISTENCY')[0]?.message ?? '';
    expect(message).toContain('Introduction');
    expect(message).toContain('Rename one');
  });

  it('is not case-sensitive — INTRODUCTION and Introduction are the same chapter', () => {
    const result = runComplianceChecks({
      ...clean(),
      chapters: [
        {
          id: 'c',
          title: 'Introduction',
          order: 1,
          content: { type: 'doc', content: [heading(1, 'INTRODUCTION'), filler()] },
        },
      ],
    });
    expect(failed(result)).not.toContain('TOC_CONSISTENCY');
  });
});

describe('8. citations', () => {
  it('fails on an orphaned citation, counted', () => {
    const result = runComplianceChecks({
      ...clean(),
      citations: { orphans: 3, bibliographyEntries: 12, style: SPEC.bibliography.style },
    });
    expect(findings(result, 'CITATIONS')[0]?.message).toContain('3 citations');
  });

  it('fails an empty bibliography', () => {
    const result = runComplianceChecks({
      ...clean(),
      citations: { orphans: 0, bibliographyEntries: 0, style: SPEC.bibliography.style },
    });
    expect(findings(result, 'CITATIONS')[0]?.message).toContain('bibliography would be empty');
  });

  it('fails when the thesis is set to a style the template does not use, naming both', () => {
    const result = runComplianceChecks({
      ...clean(),
      citations: { orphans: 0, bibliographyEntries: 12, style: 'mla' },
    });
    const message = findings(result, 'CITATIONS')[0]?.message ?? '';
    expect(message).toContain(SPEC.bibliography.style);
    expect(message).toContain('mla');
  });
});

describe('9. page setup', () => {
  const actual = {
    pageSize: SPEC.page.size,
    marginsMm: { ...SPEC.page.marginsMm },
    fontName: SPEC.font.body,
    fontSizePt: SPEC.font.sizePt,
    lineSpacing: SPEC.font.lineSpacing,
  };

  it('says nothing before the file is built', () => {
    // The check asserts what was *generated*, so it cannot speak about a file that does not exist.
    expect(failed(runComplianceChecks(clean()))).not.toContain('PAGE_SETUP');
  });

  it('passes when the generated file matches the template', () => {
    expect(failed(runComplianceChecks({ ...clean(), actualPageSetup: actual }))).not.toContain(
      'PAGE_SETUP',
    );
  });

  it('fails on a wrong margin, and names the side and both numbers', () => {
    const result = runComplianceChecks({
      ...clean(),
      actualPageSetup: {
        ...actual,
        marginsMm: { ...actual.marginsMm, left: actual.marginsMm.left + 10 },
      },
    });
    const message = findings(result, 'PAGE_SETUP')[0]?.message ?? '';
    expect(message).toContain('left margin');
    expect(message).toContain(String(actual.marginsMm.left));
  });

  it('tolerates a sub-millimetre margin difference — twips do not divide evenly into mm', () => {
    const result = runComplianceChecks({
      ...clean(),
      actualPageSetup: {
        ...actual,
        marginsMm: { ...actual.marginsMm, top: actual.marginsMm.top + 0.5 },
      },
    });
    expect(failed(result)).not.toContain('PAGE_SETUP');
  });

  it('fails on the wrong font, size or spacing', () => {
    for (const patch of [
      { fontName: 'Comic Sans MS' },
      { fontSizePt: actual.fontSizePt + 2 },
      { lineSpacing: actual.lineSpacing + 0.5 },
    ]) {
      const result = runComplianceChecks({
        ...clean(),
        actualPageSetup: { ...actual, ...patch },
      });
      expect(failed(result), JSON.stringify(patch)).toContain('PAGE_SETUP');
    }
  });
});

describe('10. word count', () => {
  it('fails a body under the template minimum, with both numbers', () => {
    if (!SPEC.minWords) return;
    const result = runComplianceChecks({
      ...clean(),
      chapters: [
        {
          id: 'c',
          title: 'Introduction',
          order: 1,
          content: { type: 'doc', content: [heading(1, 'Introduction'), para('Short.')] },
        },
      ],
    });
    const message = findings(result, 'WORD_COUNT')[0]?.message ?? '';
    expect(message).toContain(String(SPEC.minWords));
    expect(message).toContain('at least');
  });
});

describe('the readers the checks are built on', () => {
  it('headingsOf reports level and text in document order', () => {
    const rows = headingsOf(
      chapter('Introduction', heading(2, 'Background'), heading(3, 'History')),
    );
    expect(rows.map((h) => [h.level, h.text])).toEqual([
      [1, 'Introduction'],
      [2, 'Background'],
      [3, 'History'],
    ]);
  });

  it('figuresOf reads the caption from the adjacent paragraph, either side', () => {
    const rows = figuresOf({
      id: 'c',
      title: 'Results',
      order: 1,
      content: {
        type: 'doc',
        content: [
          { type: 'image', attrs: { alt: 'Drying curve' } },
          para('Figure 1.1: Drying curve'), // below the figure
          para('Table 1.1: Moisture by season'), // above the table
          { type: 'table', content: [] },
        ],
      },
    });
    expect(rows).toEqual([
      { kind: 'figure', caption: 'Figure 1.1: Drying curve', chapterTitle: 'Results' },
      { kind: 'table', caption: 'Table 1.1: Moisture by season', chapterTitle: 'Results' },
    ]);
  });

  it('figuresOf reports no caption when the adjacent paragraph is ordinary prose', () => {
    const rows = figuresOf({
      id: 'c',
      title: 'Results',
      order: 1,
      content: {
        type: 'doc',
        content: [{ type: 'image', attrs: { alt: 'x' } }, para('The dryer worked well.')],
      },
    });
    expect(rows[0]?.caption).toBeNull();
  });

  it('reads nothing rather than throwing on a malformed document', () => {
    for (const content of [null, 'text', {}, { type: 'doc' }]) {
      const row = { id: 'c', title: 'X', order: 1, content };
      expect(() => headingsOf(row)).not.toThrow();
      expect(() => figuresOf(row)).not.toThrow();
    }
  });
});
