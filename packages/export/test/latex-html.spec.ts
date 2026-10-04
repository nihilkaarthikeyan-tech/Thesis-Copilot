/**
 * The LaTeX and HTML exports — ADR-0021.
 *
 * One chapter exercises every node the editor can produce, with the awkward cases in it: text full
 * of TeX's special characters, a citation with a page, a narrative citation, one whose source was
 * removed, figures in a list and in a table cell (the first is numbered, the second is not — the
 * editor's own rule), a cross-reference to a deleted figure, equations, and an AI draft the student
 * has not accepted, which must appear in neither.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { numberingMap, readTemplateSpec, readThesisDetails } from '@tc/types';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { escapeHtml, thesisToHtml } from '../src/html.js';
import {
  biblatexLanguage,
  escapeLatex,
  thesisToLatexFiles,
  thesisToLatexZip,
} from '../src/latex.js';

const SPEC = readTemplateSpec(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../db/prisma/seed-data/example-template.json', import.meta.url)),
      'utf8',
    ),
  ),
);

const DETAILS = readThesisDetails({
  studentName: 'A. Kumar',
  degree: 'Master of Technology',
  institution: 'Example Institute of Technology',
  monthYear: 'June 2027',
  abstract: 'Drip irrigation uptake is low.\nThis thesis asks why.',
  abbreviations: { PV: 'photovoltaic' },
});

/** A 1x1 PNG. */
const PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
);

const text = (value: string, marks?: Array<{ type: string; attrs?: Record<string, unknown> }>) => ({
  type: 'text',
  text: value,
  ...(marks ? { marks } : {}),
});
const para = (...content: unknown[]) => ({ type: 'paragraph', content });

const CONTENT = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [text('Results & Discussion')] },
    { type: 'heading', attrs: { level: 2 }, content: [text('Uptake by district')] },
    para(
      text('Costs rose 50% for R&D_1 ~ $5 #2 {x} ^ \\ '),
      text('sharply', [{ type: 'bold' }]),
      text(' '),
      text('here', [{ type: 'link', attrs: { href: 'https://example.org/a?b=1#c' } }]),
      text(' '),
      { type: 'citation', attrs: { key: 'c1', sourceId: 's1', role: 'parenthetical' } },
      text(' and '),
      { type: 'citation', attrs: { key: 'c2', sourceId: 's2', role: 'narrative' } },
      text(' and '),
      { type: 'citation', attrs: { key: 'gone', sourceId: 'removed', role: 'parenthetical' } },
      text('. See '),
      { type: 'crossRef', attrs: { refId: 'fig-b', kind: 'figure' } },
      text(', '),
      { type: 'crossRef', attrs: { refId: 'tab-a', kind: 'table' } },
      text(' and '),
      { type: 'crossRef', attrs: { refId: 'deleted', kind: 'figure' } },
      text(', where '),
      { type: 'mathInline', attrs: { latex: 'E = mc^2' } },
      text('.'),
    ),
    { type: 'mathBlock', attrs: { latex: '\\sum_{i=1}^{n} x_i' } },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            para(text('A figure in a list is still a figure:')),
            { type: 'image', attrs: { key: 'figures/a.png', refId: 'fig-a', alt: 'Uptake map' } },
          ],
        },
      ],
    },
    {
      type: 'table',
      attrs: { refId: 'tab-a', caption: 'Costs by district' },
      content: [
        {
          type: 'tableRow',
          content: [
            { type: 'tableHeader', content: [para(text('District'))] },
            { type: 'tableHeader', content: [para(text('Cost'))] },
          ],
        },
        {
          type: 'tableRow',
          content: [
            { type: 'tableCell', content: [para(text('Salem'))] },
            {
              type: 'tableCell',
              content: [{ type: 'image', attrs: { key: 'figures/in-cell.png', alt: 'Sparkline' } }],
            },
          ],
        },
      ],
    },
    {
      type: 'image',
      // `alt` is the uploaded file's name, as the editor sets it; the caption is the student's.
      attrs: { key: 'figures/b.png', refId: 'fig-b', alt: 'b.png', caption: 'Adoption curve' },
    },
    {
      type: 'draftBlock',
      attrs: { draftId: 'd1', status: 'pending' },
      content: [para(text('UNACCEPTED DRAFT TEXT'))],
    },
  ],
};

const IMAGES = {
  'figures/a.png': { data: PNG, width: 120, height: 80, type: 'png' as const },
  'figures/b.png': { data: PNG, width: 120, height: 80, type: 'png' as const },
  'figures/in-cell.png': { data: PNG, width: 40, height: 10, type: 'png' as const },
};

const CHAPTER = {
  id: 'ch1',
  title: 'Results',
  order: 2,
  content: CONTENT,
  renderedMap: { c1: '(Kumar, 2021, p. 12)', c2: 'Rao (2019)' },
};

describe('the LaTeX project', () => {
  const files = thesisToLatexFiles({
    spec: SPEC,
    details: DETAILS,
    documentTitle: 'Why farmers do not drip',
    chapters: [CHAPTER],
    bibliography: [],
    images: IMAGES,
    citeKeys: { c1: 'kumar2021', c2: 'rao2019' },
    locators: { c1: '12' },
    bibtex: '@article{kumar2021, title = {Drip}}\n',
    bibStyle: 'authoryear',
    styleLabel: 'APA 7th edition',
    exportedOn: '2026-09-24',
  });
  const main = String(files.find((f) => f.path === 'main.tex')?.data);

  it('escapes every character that means something to TeX', () => {
    expect(escapeLatex('50% R&D_1 ~ $5 #2 {x} ^ \\')).toBe(
      '50\\% R\\&D\\_1 \\textasciitilde{} \\$5 \\#2 \\{x\\} \\textasciicircum{} \\textbackslash{}',
    );
    expect(main).toContain('Costs rose 50\\% for R\\&D\\_1');
    expect(main).toContain('\\chapter{Results \\& Discussion}');
  });

  it('writes Unicode sub- and superscripts as text commands pdfLaTeX can set (ADR-0045)', () => {
    expect(escapeLatex('CO₂ at 25 m² and Fe³⁺')).toBe(
      'CO\\textsubscript{2} at 25 m\\textsuperscript{2} and Fe\\textsuperscript{3+}',
    );
  });

  it('cites with real commands over the .bib, page and all, and marks a lost source', () => {
    expect(main).toContain('\\parencite[12]{kumar2021}');
    expect(main).toContain('\\textcite{rao2019}');
    expect(main).toContain('\\textbf{(source missing)}');
    expect(main).toContain('\\usepackage[style=authoryear,backend=biber]{biblatex}');
    expect(main).toContain('\\addbibresource{references.bib}');
    expect(files.find((f) => f.path === 'references.bib')?.data).toContain('@article{kumar2021');
  });

  it('tells biblatex the citation locale when there is one (ADR-0058)', () => {
    const british = thesisToLatexFiles({
      spec: SPEC,
      details: DETAILS,
      documentTitle: 'Why farmers do not drip',
      chapters: [CHAPTER],
      bibliography: [],
      images: IMAGES,
      citeKeys: { c1: 'kumar2021', c2: 'rao2019' },
      bibtex: '@article{kumar2021, title = {Drip}}\n',
      bibStyle: 'authoryear',
      citationLocale: 'en-GB',
      styleLabel: 'APA 7th edition',
      exportedOn: '2026-09-24',
    });
    expect(String(british.find((f) => f.path === 'main.tex')?.data)).toContain(
      '\\usepackage[style=authoryear,backend=biber,language=british]{biblatex}',
    );
    expect(biblatexLanguage('de-DE')).toBe('german');
    expect(biblatexLanguage('pt-BR')).toBeNull();
    expect(biblatexLanguage(null)).toBeNull();
  });

  it('numbers figures as the editor does, and points cross-references at them', () => {
    // The editor's numbering: the list's figure is 1, the cell's is not counted, the last is 2.
    const numbers = numberingMap(CONTENT);
    expect(numbers.get('fig-a')?.index).toBe(1);
    expect(numbers.get('fig-b')?.index).toBe(2);
    expect(main).toContain('\\label{fig:2.1}');
    expect(main).toContain('\\label{fig:2.2}');
    expect(main).toContain('\\figurename~\\ref{fig:2.2}');
    expect(main).toContain('\\tablename~\\ref{tab:2.1}');
    expect(main).toContain('\\textbf{[Figure --- deleted]}');
    // The cell's picture is in the table, uncaptioned; all three files are in the project.
    expect(files.filter((f) => f.path.startsWith('figures/')).map((f) => f.path)).toEqual([
      'figures/chapter-2-1.png',
      'figures/chapter-2-2.png',
      'figures/chapter-2-3.png',
    ]);
  });

  it('typesets the equations the student wrote', () => {
    expect(main).toContain('\\(E = mc^2\\)');
    expect(main).toContain('\\[\n\\sum_{i=1}^{n} x_i\n\\]');
  });

  it('builds a table TeX can lay out, with its header row bold', () => {
    expect(main).toContain('\\begin{tabularx}{\\linewidth}{|X|X|}');
    expect(main).toContain('\\textbf{District} & \\textbf{Cost} \\\\ \\hline');
  });

  it('keeps a link, escaped for TeX', () => {
    expect(main).toContain('\\href{https://example.org/a?b=1\\#c}{here}');
  });

  it('leaves out an AI draft the student has not accepted', () => {
    expect(main).not.toContain('UNACCEPTED');
  });

  it('follows the template: front matter in order, margins, spacing', () => {
    expect(main).toContain('\\begin{titlepage}');
    expect(main).toContain('\\chapter*{Abstract}');
    expect(main).toContain('\\item[PV] photovoltaic');
    expect(main).toContain(
      `left=${SPEC.page.marginsMm.left}mm,right=${SPEC.page.marginsMm.right}mm`,
    );
    expect(main.indexOf('\\begin{titlepage}')).toBeLessThan(main.indexOf('\\chapter{'));
  });

  it('says plainly, at the top, whose style formats the reference list', () => {
    expect(main.slice(0, 900)).toContain('APA 7th edition');
    expect(main.slice(0, 900)).toContain('"authoryear"');
  });

  it('zips into a project with main.tex at its root', async () => {
    const zip = await JSZip.loadAsync(
      await thesisToLatexZip({
        spec: SPEC,
        details: DETAILS,
        documentTitle: 'T',
        chapters: [CHAPTER],
        bibliography: [],
        images: IMAGES,
        citeKeys: {},
        bibtex: '',
        bibStyle: 'numeric',
        styleLabel: 'IEEE',
        exportedOn: '2026-09-24',
      }),
    );
    expect(Object.keys(zip.files).sort()).toEqual([
      'README.txt',
      'figures/',
      'figures/chapter-2-1.png',
      'figures/chapter-2-2.png',
      'figures/chapter-2-3.png',
      'main.tex',
      'references.bib',
    ]);
  });
});

describe('the HTML page', () => {
  const html = thesisToHtml({
    spec: SPEC,
    details: DETAILS,
    documentTitle: 'Why farmers do not drip',
    chapters: [CHAPTER],
    bibliography: [
      { sourceId: 's1', text: 'Kumar, A. (2021). Drip & cost. Journal <Agri>.' },
      { sourceId: 's2', text: 'Rao, B. (2019). Uptake.' },
    ],
    citeSources: { c1: 's1', c2: 's2' },
    images: IMAGES,
    language: 'ta',
    exportedOn: '2026-09-24',
  });

  it('is one page in the thesis’s language', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang="ta">');
    expect(html).toContain('<title>Why farmers do not drip</title>');
  });

  it('escapes the student’s text', () => {
    expect(escapeHtml('<b> & "q"')).toBe('&lt;b&gt; &amp; &quot;q&quot;');
    expect(html).toContain('Costs rose 50% for R&amp;D_1');
    expect(html).toContain('Journal &lt;Agri&gt;');
  });

  it('shows citations as the editor does, each linked to its reference', () => {
    expect(html).toContain('<a class="citation" href="#ref-s1">(Kumar, 2021, p. 12)</a>');
    expect(html).toContain('<a class="citation" href="#ref-s2">Rao (2019)</a>');
    expect(html).toContain('<li id="ref-s1">');
    expect(html).toContain('<strong class="missing">(source missing)</strong>');
  });

  it('draws equations as MathML, with no script', () => {
    expect(html).toContain('<math');
    expect(html).not.toContain('<script');
  });

  it('carries its figures inside it, captioned and numbered as the editor numbers them', () => {
    expect(html).toContain('<figure id="fig-2-1">');
    expect(html).toContain('<figure id="fig-2-2">');
    expect(html).toContain('data:image/png;base64,');
    expect(html).toMatch(/Figure 2\.2: Adoption curve/);
    expect(html).toContain('<a href="#fig-2-2">Figure 2.2</a>');
    expect(html).toContain('<strong class="missing">[Figure — deleted]</strong>');
  });

  it('builds the table with its header cells and caption', () => {
    expect(html).toContain('<th><p>District</p></th>');
    expect(html).toMatch(/Table 2\.1: Costs by district/);
  });

  it('only links where a reader can safely go', () => {
    expect(html).toContain(
      '<a href="https://example.org/a?b=1#c" rel="noopener noreferrer">here</a>',
    );
  });

  it('leaves out an AI draft the student has not accepted', () => {
    expect(html).not.toContain('UNACCEPTED');
  });

  it('has the front matter, and a contents that links to every chapter', () => {
    expect(html).toContain('<header class="title-page">');
    expect(html).toContain('<a href="#chapter-2">');
    expect(html).toContain('<dt>PV</dt><dd>photovoltaic</dd>');
  });
});
