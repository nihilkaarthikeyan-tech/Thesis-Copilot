/**
 * R28 (ADR-0119): text colour, highlight, the horizontal rule and the contents block, through
 * every export — the chapter `.docx`, the thesis `.docx` (and so its PDF), HTML and LaTeX.
 *
 * The LaTeX highlighter and the `ulemSafe` fix were compiled with pdfLaTeX (TeX Live 2026) on
 * 2026-10-08 and read back as a PDF; these tests pin the source those runs proved.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readTemplateSpec, readThesisDetails, type TemplateSpec } from '@tc/types';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { hasContentsBlock, ulemSafe } from '../src/colors.js';
import { chapterToDocx } from '../src/docx.js';
import { thesisToHtml } from '../src/html.js';
import { thesisToLatexFiles } from '../src/latex.js';
import { frontMatterOf, type ThesisChapter, thesisToDocx } from '../src/thesis.js';

const SPEC = readTemplateSpec(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../db/prisma/seed-data/example-template.json', import.meta.url)),
      'utf8',
    ),
  ),
);
/** The same template without a contents page of its own. */
const NO_TOC: TemplateSpec = {
  ...SPEC,
  frontMatter: SPEC.frontMatter.filter((section) => section.id !== 'TOC'),
};

const DETAILS = readThesisDetails({ studentName: 'A. Kumar', degree: 'M.Tech' });

const text = (value: string, marks?: Array<{ type: string; attrs?: Record<string, unknown> }>) => ({
  type: 'text',
  text: value,
  ...(marks ? { marks } : {}),
});

const CONTENT = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [text('Methods')] },
    { type: 'tableOfContents' },
    { type: 'heading', attrs: { level: 2 }, content: [text('Study area')] },
    {
      type: 'paragraph',
      content: [
        text('Rain '),
        text('fell', [{ type: 'highlight', attrs: { color: 'green' } }]),
        text(' and '),
        text('rose', [{ type: 'textColor', attrs: { color: 'red' } }]),
        text(' and '),
        text('both', [
          { type: 'bold' },
          { type: 'strike' },
          { type: 'highlight', attrs: { color: 'pink' } },
          { type: 'textColor', attrs: { color: 'blue' } },
        ]),
        text('.'),
      ],
    },
    { type: 'horizontalRule' },
    { type: 'heading', attrs: { level: 3 }, content: [text('Climate')] },
    { type: 'paragraph', content: [text('After the rule.')] },
    {
      type: 'draftBlock',
      attrs: { draftId: 'd-1', status: 'pending' },
      content: [{ type: 'heading', attrs: { level: 2 }, content: [text('Drafted heading')] }],
    },
  ],
};

const CHAPTER: ThesisChapter = {
  id: 'ch-1',
  title: 'Methods',
  order: 3,
  content: CONTENT,
  renderedMap: {},
};

async function xmlOf(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  return (await zip.file('word/document.xml')?.async('string')) ?? '';
}

/** The `<w:r>` holding `word`, so its properties can be read. */
function runWith(xml: string, word: string): string {
  const runs = xml.match(/<w:r>(?:(?!<\/w:r>).)*<\/w:r>/gs) ?? [];
  return runs.find((run) => run.includes(`>${word}</w:t>`)) ?? '';
}

describe('the chapter .docx', () => {
  it('prints a text colour exactly and a highlight as Word’s own highlight', async () => {
    const xml = await xmlOf(await chapterToDocx(CONTENT, { title: 'Methods', chapterNumber: 3 }));
    expect(runWith(xml, 'fell')).toContain('<w:highlight w:val="green"/>');
    expect(runWith(xml, 'rose')).toContain('<w:color w:val="B42318"/>');
    const both = runWith(xml, 'both');
    expect(both).toContain('<w:highlight w:val="magenta"/>');
    expect(both).toContain('<w:color w:val="175CD3"/>');
    expect(both).toContain('<w:strike/>');
    // Nothing else picks up a colour.
    expect(runWith(xml, 'Rain ')).not.toMatch(/w:highlight|w:color/);
  });

  it('draws the rule as a bottom border, and the contents block as a TOC field', async () => {
    const xml = await xmlOf(
      await chapterToDocx(CONTENT, { title: 'Methods', chapterNumber: 3, numberHeadings: true }),
    );
    expect(xml).toMatch(/<w:pBdr><w:bottom [^>]*w:val="single"/);
    expect(xml).toContain('TOC \\h \\o &quot;1-3&quot;');
    // The chapter title is printed once — the title line and its contents entry — not again as
    // the first heading.
    expect(xml.match(/>3\. Methods</g)?.length).toBe(2);
    expect(xml).not.toContain('>Methods</w:t>');
    // Filled with this chapter's headings as the file numbers them, before any update — and not
    // the heading of a draft the student has not accepted.
    const field = xml.slice(xml.indexOf('<w:sdt>'), xml.indexOf('</w:sdt>'));
    expect(field).toContain('3. Methods');
    expect(field).toContain('3.1 Study area');
    expect(field).toContain('3.1.1 Climate');
    expect(field).not.toContain('Drafted heading');
    // A TOC field collects by outline level: every heading carries one.
    expect(xml.match(/<w:outlineLvl w:val="\d"\/>/g)?.length).toBeGreaterThanOrEqual(3);
  });
});

describe('the thesis .docx', () => {
  it('prints colours and the rule, and puts the contents page at the front only once', async () => {
    const xml = await xmlOf(
      await thesisToDocx({
        spec: SPEC,
        details: DETAILS,
        documentTitle: 'Drip irrigation',
        chapters: [CHAPTER],
        bibliography: [],
      }),
    );
    expect(runWith(xml, 'fell')).toContain('<w:highlight w:val="green"/>');
    expect(runWith(xml, 'rose')).toContain('<w:color w:val="B42318"/>');
    expect(runWith(xml, 'both')).toContain('<w:strike/>');
    expect(xml).toMatch(/<w:pBdr><w:bottom [^>]*w:val="single"/);
    // The template's own contents page, and no second one from the block.
    expect(xml.match(/TOC \\h \\o &quot;1-3&quot;/g)?.length).toBe(1);
  });

  it('adds a contents page when the template has none and a chapter asks for one', async () => {
    expect(frontMatterOf({ spec: NO_TOC, chapters: [CHAPTER] }).map((s) => s.id)).toEqual([
      'TITLE_PAGE',
      'CERTIFICATE',
      'DECLARATION',
      'ACKNOWLEDGEMENTS',
      'ABSTRACT',
      'TOC',
      'LIST_OF_FIGURES',
      'LIST_OF_TABLES',
      'ABBREVIATIONS',
    ]);
    const plain = { ...CHAPTER, content: { type: 'doc', content: [] } };
    expect(frontMatterOf({ spec: NO_TOC, chapters: [plain] }).map((s) => s.id)).not.toContain(
      'TOC',
    );
    // A contents block inside a pending draft does not ask for anything.
    const drafted = {
      ...CHAPTER,
      content: {
        type: 'doc',
        content: [{ type: 'draftBlock', content: [{ type: 'tableOfContents' }] }],
      },
    };
    expect(frontMatterOf({ spec: NO_TOC, chapters: [drafted] }).map((s) => s.id)).not.toContain(
      'TOC',
    );
    const xml = await xmlOf(
      await thesisToDocx({
        spec: NO_TOC,
        details: DETAILS,
        documentTitle: 'Drip irrigation',
        chapters: [CHAPTER],
        bibliography: [],
      }),
    );
    expect(xml.match(/TOC \\h \\o &quot;1-3&quot;/g)?.length).toBe(1);
  });
});

describe('the HTML export', () => {
  const html = thesisToHtml({
    spec: NO_TOC,
    details: DETAILS,
    documentTitle: 'Drip irrigation',
    chapters: [CHAPTER],
    bibliography: [],
    exportedOn: '2026-10-08',
  });

  it('marks colours by class, with the rules for them in the page', () => {
    expect(html).toContain('<mark class="hl-green">fell</mark>');
    expect(html).toContain('<span class="ink-red">rose</span>');
    expect(html).toContain(
      '<span class="ink-blue"><mark class="hl-pink"><s><strong>both</strong></s></mark></span>',
    );
    expect(html).toContain('.ink-red { color: #B42318; }');
    expect(html).toContain('mark.hl-green { background: #BBF7D0; color: inherit; }');
  });

  it('draws the rule and lists the contents at the front', () => {
    expect(html).toContain('<hr>');
    expect(html).toContain('<section class="front" id="contents">');
    expect(html).not.toContain('Drafted heading');
  });
});

describe('the LaTeX export', () => {
  const main = String(
    thesisToLatexFiles({
      spec: NO_TOC,
      details: DETAILS,
      documentTitle: 'Drip irrigation',
      chapters: [CHAPTER],
      bibliography: [],
      citeKeys: {},
      bibtex: '',
      bibStyle: 'authoryear',
      styleLabel: 'APA 7',
      exportedOn: '2026-10-08',
    }).find((file) => file.path === 'main.tex')?.data,
  );

  it('defines the palette and the highlighter, and uses them', () => {
    expect(main).toContain('\\usepackage{xcolor}');
    expect(main).toContain('\\definecolor{tcinkred}{HTML}{B42318}');
    expect(main).toContain('\\definecolor{tchlgreen}{HTML}{BBF7D0}');
    expect(main).toContain('\\newcommand{\\tchl}[1]{');
    expect(main).toContain('\\tchl{tchlgreen}{fell}');
    expect(main).toContain('\\textcolor{tcinkred}{rose}');
    // The highlight round every other mark, so the strike-through shows on top of it.
    expect(main).toContain('\\textcolor{tcinkblue}{\\tchl{tchlpink}{\\sout{\\textbf{both}}}}');
  });

  it('draws the rule and asks for the contents in the front matter, once', () => {
    expect(main).toContain('\\noindent\\rule{\\linewidth}{0.4pt}');
    expect(main.match(/\\tableofcontents/g)?.length).toBe(1);
  });
});

describe('ulemSafe', () => {
  it('boxes sub- and superscripts so ulem can take them, and leaves the rest alone', () => {
    expect(ulemSafe('CO\\textsubscript{2} and m\\textsuperscript{2}')).toBe(
      'CO\\mbox{\\textsubscript{2}} and m\\mbox{\\textsuperscript{2}}',
    );
    expect(ulemSafe('\\textsuperscript{\\textbf{x}} y')).toBe(
      '\\mbox{\\textsuperscript{\\textbf{x}}} y',
    );
    expect(ulemSafe('\\textsuperscript{\\{x\\}}')).toBe('\\mbox{\\textsuperscript{\\{x\\}}}');
    expect(ulemSafe('\\textbf{bold} 50\\%')).toBe('\\textbf{bold} 50\\%');
  });
});

describe('hasContentsBlock', () => {
  it('finds a contents block at any depth', () => {
    expect(hasContentsBlock(CONTENT)).toBe(true);
    expect(hasContentsBlock({ type: 'doc', content: [{ type: 'blockquote', content: [] }] })).toBe(
      false,
    );
  });
});
