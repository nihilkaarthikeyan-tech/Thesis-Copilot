/**
 * R27 (ADR-0121): the export dialog's layout in the files — presets and advanced options through
 * `applyLayout` into the thesis `.docx`, the page setup of the chapter `.docx`, two columns, page
 * numbers off, and a guide's comments as Word comments.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyLayout, readTemplateSpec, readThesisDetails, resolveLayout } from '@tc/types';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { chapterToDocx } from '../src/docx.js';
import { thesisToLatexFiles } from '../src/latex.js';
import { pageSetupOf, type ThesisChapter, thesisToDocx } from '../src/thesis.js';
import type { ExportComment } from '../src/word-comments.js';

const SPEC = readTemplateSpec(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../db/prisma/seed-data/example-template.json', import.meta.url)),
      'utf8',
    ),
  ),
);
const DETAILS = readThesisDetails({ studentName: 'A. Kumar', degree: 'M.Tech', abstract: 'Why.' });

const text = (value: string) => ({ type: 'text', text: value });
const CONTENT = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [text('Methods')] },
    {
      type: 'paragraph',
      content: [text('Rainfall fell sharply over the decade in both districts.')],
    },
    { type: 'heading', attrs: { level: 2 }, content: [text('Sampling')] },
    { type: 'paragraph', content: [text('Farmers were chosen at random.')] },
  ],
};
const CHAPTER: ThesisChapter = {
  id: 'ch-1',
  title: 'Methods',
  order: 1,
  content: CONTENT,
  renderedMap: {},
};

const COMMENTS: ExportComment[] = [
  {
    id: 'cm-1',
    chapterId: 'ch-1',
    author: 'guide.rao@example.edu',
    date: new Date('2026-10-01T10:00:00Z'),
    quotedText: 'fell sharply  over the decade',
    body: 'Which years?',
    replies: [
      { author: 'A. Kumar', body: '2011 to 2021.', date: new Date('2026-10-02T10:00:00Z') },
    ],
  },
  {
    id: 'cm-2',
    chapterId: 'ch-1',
    author: 'guide.rao@example.edu',
    date: new Date('2026-10-01T11:00:00Z'),
    quotedText: 'words no longer here',
    body: 'Cite this.',
    replies: [],
  },
];

async function parts(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const read = async (name: string) => (await zip.file(name)?.async('string')) ?? '';
  return {
    document: await read('word/document.xml'),
    styles: await read('word/styles.xml'),
    comments: await read('word/comments.xml'),
    footers: Object.keys(zip.files).filter((n) => /^word\/footer\d*\.xml$/.test(n)).length,
  };
}

const thesis = (layout: Parameters<typeof resolveLayout>[1], extra = {}) => {
  const resolved = resolveLayout(SPEC, layout);
  return thesisToDocx({
    spec: applyLayout(SPEC, resolved),
    details: DETAILS,
    documentTitle: 'Drip irrigation',
    chapters: [CHAPTER],
    bibliography: [],
    layout: { columns: resolved.columns, pageNumbers: resolved.pageNumbers },
    ...extra,
  });
};

describe('the thesis .docx follows the layout', () => {
  it('the thesis preset is the template; PAGE_SETUP reads it back', async () => {
    const { document } = await parts(await thesis({ preset: 'thesis' }));
    expect(document).toContain('TOC \\h \\o &quot;1-3&quot;');
    expect(document).toContain('DRIP IRRIGATION'); // the title page
    expect(pageSetupOf(applyLayout(SPEC, resolveLayout(SPEC, { preset: 'thesis' })))).toEqual(
      pageSetupOf(SPEC),
    );
  });

  it('double-spaced: Times 12, double lines, 1-inch margins, no title page or certificate', async () => {
    const { document, styles } = await parts(await thesis({ preset: 'double' }));
    expect(document).not.toContain('DRIP IRRIGATION');
    expect(document).not.toContain('CERTIFICATE');
    expect(document).toContain('w:left="1440"'); // 25.4 mm
    expect(styles).toContain('w:line="480"');
    expect(styles).toContain('<w:sz w:val="24"/>');
  });

  it('two-column: the body section in two columns, 10 pt', async () => {
    const { document, styles } = await parts(await thesis({ preset: 'two-column' }));
    expect(document).toMatch(/<w:cols [^>]*w:num="2"/);
    expect(styles).toContain('<w:sz w:val="20"/>');
  });

  it('page numbers off writes no footer', async () => {
    expect((await parts(await thesis({ preset: 'thesis' }))).footers).toBeGreaterThan(0);
    expect((await parts(await thesis({ preset: 'thesis', pageNumbers: false }))).footers).toBe(0);
  });

  it('includes the comments: on the words they quote, else on the title, with their replies', async () => {
    const { document, comments } = await parts(
      await thesis({ preset: 'thesis', comments: true }, { comments: COMMENTS }),
    );
    expect(comments).toContain('w:author="guide.rao@example.edu"');
    expect(comments).toContain('Which years?');
    expect(comments).toContain('2011 to 2021.');
    // Comment 1 wraps the paragraph that holds its words; comment 2 the chapter title.
    const para = document.slice(document.lastIndexOf('<w:p>', document.indexOf('Rainfall fell')));
    expect(para.slice(0, para.indexOf('</w:p>'))).toContain('<w:commentRangeStart w:id="1"/>');
    const title = document.slice(document.lastIndexOf('<w:p>', document.indexOf('>METHODS<')));
    expect(title.slice(0, title.indexOf('</w:p>'))).toContain('<w:commentRangeStart w:id="2"/>');
  });

  it('without the option, no comments part', async () => {
    expect((await parts(await thesis({ preset: 'thesis' }))).comments).not.toContain('<w:comment ');
  });
});

describe('the chapter .docx follows the layout', () => {
  it('writes the page, the font and two columns', async () => {
    const resolved = resolveLayout(SPEC, { preset: 'two-column', paper: 'Letter', font: 'Arial' });
    const { document, styles, footers } = await parts(
      await chapterToDocx(CONTENT, {
        title: 'Methods',
        page: {
          size: resolved.paper,
          marginsMm: resolved.marginsMm,
          font: resolved.font,
          sizePt: resolved.sizePt,
          lineSpacing: resolved.lineSpacing,
          paragraphSpacingPt: resolved.paragraphSpacingPt,
          justify: resolved.justify,
          columns: resolved.columns,
          pageNumbers: resolved.pageNumbers,
        },
        comments: { chapterId: 'ch-1', list: COMMENTS },
      }),
    );
    expect(document).toContain('w:w="12240"'); // Letter, 8.5 in
    expect(document).toMatch(/<w:cols [^>]*w:num="2"/);
    expect(styles).toContain('w:ascii="Arial"');
    expect(footers).toBeGreaterThan(0);
    expect(document).toContain('<w:commentRangeStart w:id="1"/>');
  });
});

describe('the LaTeX project follows the layout', () => {
  it('two columns and no page numbers', () => {
    const resolved = resolveLayout(SPEC, { preset: 'two-column', pageNumbers: false });
    const main = String(
      thesisToLatexFiles({
        spec: applyLayout(SPEC, resolved),
        details: DETAILS,
        documentTitle: 'Drip irrigation',
        chapters: [CHAPTER],
        bibliography: [],
        layout: { columns: 2, pageNumbers: false },
        citeKeys: {},
        bibtex: '',
        bibStyle: 'authoryear',
        styleLabel: 'APA 7',
        exportedOn: '2026-10-08',
      }).find((f) => f.path === 'main.tex')?.data,
    );
    expect(main).toContain(',twocolumn]{report}');
    expect(main).not.toContain('\\pagenumbering{roman}');
    expect(main).toContain('\\pagenumbering{gobble}');
  });
});
