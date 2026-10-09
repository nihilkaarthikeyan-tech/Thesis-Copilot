/**
 * Fix list A29: a cross-reference and the caption it points at carry the same number in every
 * export — the chapter `.docx`, the whole-thesis `.docx` (and so its PDF), the LaTeX project and
 * the web page.
 *
 * The chapter has the cases where two counters could drift apart: an unaccepted AI draft holding a
 * table (the gap analysis of ADR-0123 makes exactly this), a figure inside a table cell (never
 * numbered — the editor's rule), a figure in a list, and references both before and after their
 * targets.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { numberingMap, readTemplateSpec, readThesisDetails } from '@tc/types';
import { describe, expect, it } from 'vitest';
import { chapterToDocx } from '../src/docx.js';
import { thesisToHtml } from '../src/html.js';
import { thesisToLatexFiles } from '../src/latex.js';
import { thesisToDocx, withoutPendingDrafts } from '../src/thesis.js';

function documentXml(buffer: Buffer): string {
  let offset = 0;
  while (offset < buffer.length - 4) {
    if (buffer.readUInt32LE(offset) !== 0x04_03_4b_50) {
      offset++;
      continue;
    }
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString('latin1');
    const dataStart = nameStart + nameLength + extraLength;
    if (name === 'word/document.xml') {
      const data = buffer.subarray(dataStart, dataStart + compressedSize);
      return method === 0 ? data.toString('utf8') : inflateRawSync(data).toString('utf8');
    }
    offset = dataStart + compressedSize;
  }
  return '';
}

/** The visible text of a Word document, paragraph by paragraph. */
const paragraphsOf = (xml: string): string[] =>
  xml
    .split('</w:p>')
    .map((p) => [...p.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(''))
    .filter(Boolean);

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
});

const PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
);
const IMAGES = {
  'figures/cell.png': { data: PNG, width: 40, height: 10, type: 'png' as const },
  'figures/list.png': { data: PNG, width: 120, height: 80, type: 'png' as const },
  'figures/main.png': { data: PNG, width: 120, height: 80, type: 'png' as const },
};

const text = (value: string) => ({ type: 'text', text: value });
const para = (...content: unknown[]) => ({ type: 'paragraph', content });
const ref = (refId: string, kind: 'figure' | 'table') => ({
  type: 'crossRef',
  attrs: { refId, kind },
});
const row = (...cells: unknown[][]) => ({
  type: 'tableRow',
  content: cells.map((content) => ({ type: 'tableCell', content })),
});

const CONTENT = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [text('Results')] },
    // References before their targets.
    para(
      text('As REF-A shows, and REF-B confirms: '),
      ref('fig-main', 'figure'),
      text(' and '),
      ref('tab-main', 'table'),
      text('.'),
    ),
    {
      type: 'draftBlock',
      attrs: { draftId: 'd1', status: 'pending' },
      content: [
        para(text('UNACCEPTED DRAFT')),
        {
          type: 'table',
          attrs: { refId: 'tab-draft', caption: 'A table in a draft' },
          content: [row([para(text('x'))])],
        },
      ],
    },
    {
      type: 'table',
      attrs: { refId: 'tab-cells', caption: 'Holds a picture' },
      content: [row([{ type: 'image', attrs: { key: 'figures/cell.png', alt: 'cell.png' } }])],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            para(text('A figure in a list:')),
            {
              type: 'image',
              attrs: { key: 'figures/list.png', refId: 'fig-list', caption: 'In a list' },
            },
          ],
        },
      ],
    },
    {
      type: 'image',
      attrs: { key: 'figures/main.png', refId: 'fig-main', caption: 'Main figure' },
    },
    {
      type: 'table',
      attrs: { refId: 'tab-main', caption: 'Main table' },
      content: [row([para(text('y'))])],
    },
    // And after.
    para(
      text('Again: '),
      ref('fig-main', 'figure'),
      text(', '),
      ref('tab-main', 'table'),
      text(', '),
      ref('fig-list', 'figure'),
      text('.'),
    ),
  ],
};

const CHAPTER = { id: 'ch3', title: 'Results', order: 3, content: CONTENT, renderedMap: {} };

/** The number a caption carries, e.g. "Figure 3.2: Main figure" → "3.2". */
const captionNumber = (
  lines: string[],
  kind: 'Figure' | 'Table',
  caption: string,
): string | null => {
  // The number directly before this caption's own words, wherever the line breaks fall.
  const found = lines
    .join(' ')
    .match(new RegExp(String.raw`${kind}\s+(\d+\.\d+)[:.]?\s*${caption}`));
  return found?.[1] ?? null;
};
/** Every number the references print, in order, e.g. ["3.2", "3.2"]. */
const refNumbers = (body: string, kind: 'Figure' | 'Table'): string[] =>
  [...body.matchAll(new RegExp(`(?<!\\w)${kind}\\s+(\\d+\\.\\d+)(?![^<]*:)`, 'g'))].map(
    (m) => m[1] ?? '',
  );

describe('A29: references and captions agree in every export', () => {
  it('the editor’s numbering', () => {
    const map = numberingMap(CONTENT);
    expect(map.get('fig-main')?.index, 'figures: list, main').toBe(2);
    expect(map.get('tab-main')?.index).toBeDefined();
  });

  it('the chapter .docx', async () => {
    const xml = documentXml(
      await chapterToDocx(CONTENT, {
        title: 'Results',
        renderedMap: {},
        images: IMAGES as never,
        // As the export service passes it (A29): numbered without the pending drafts.
        refTargets: numberingMap(withoutPendingDrafts(CONTENT)),
        numberHeadings: true,
        chapterNumber: 3,
      }),
    );
    const lines = paragraphsOf(xml);
    expect(lines.join('\n')).not.toContain('UNACCEPTED DRAFT');
    const fig = captionNumber(lines, 'Figure', 'Main figure');
    const tab = captionNumber(lines, 'Table', 'Main table');
    const list = captionNumber(lines, 'Figure', 'In a list');
    expect(fig).not.toBeNull();
    const before = lines.find((l) => l.startsWith('As REF-A')) ?? '';
    const after = lines.find((l) => l.startsWith('Again')) ?? '';
    expect(before).toContain(`Figure ${fig}`);
    expect(before).toContain(`Table ${tab}`);
    expect(after).toContain(`Figure ${fig}`);
    expect(after).toContain(`Table ${tab}`);
    expect(after).toContain(`Figure ${list}`);
  });

  it('the whole-thesis .docx (and so its PDF)', async () => {
    const xml = documentXml(
      await thesisToDocx({
        spec: SPEC,
        details: DETAILS,
        documentTitle: 'Numbering',
        chapters: [CHAPTER],
        bibliography: [],
        images: IMAGES as never,
      }),
    );
    const lines = paragraphsOf(xml);
    expect(lines.join('\n')).not.toContain('UNACCEPTED DRAFT');
    const fig = captionNumber(lines, 'Figure', 'Main figure');
    const tab = captionNumber(lines, 'Table', 'Main table');
    const list = captionNumber(lines, 'Figure', 'In a list');
    expect(fig).not.toBeNull();
    expect(tab).not.toBeNull();
    const before = lines.find((l) => l.startsWith('As REF-A')) ?? '';
    const after = lines.find((l) => l.startsWith('Again')) ?? '';
    expect(before).toContain(`Figure ${fig}`);
    expect(before).toContain(`Table ${tab}`);
    expect(after).toContain(`Figure ${fig}`);
    expect(after).toContain(`Table ${tab}`);
    expect(after).toContain(`Figure ${list}`);
  });

  it('the web page', () => {
    const html = thesisToHtml({
      spec: SPEC,
      details: DETAILS,
      documentTitle: 'Numbering',
      chapters: [CHAPTER],
      bibliography: [],
      images: IMAGES,
      styleLabel: 'APA 7th edition',
      exportedOn: '2026-10-09',
    } as never);
    const plain = html.replace(/<[^>]+>/g, '');
    expect(plain).not.toContain('UNACCEPTED DRAFT');
    const lines = plain
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const fig = captionNumber(lines, 'Figure', 'Main figure');
    const tab = captionNumber(lines, 'Table', 'Main table');
    expect(fig).not.toBeNull();
    const after = lines.find((l) => l.startsWith('Again')) ?? '';
    expect(after).toContain(`Figure ${fig}`);
    expect(after).toContain(`Table ${tab}`);
  });

  it('the LaTeX project numbers by \\label and \\ref, so the two cannot drift', () => {
    const files = thesisToLatexFiles({
      spec: SPEC,
      details: DETAILS,
      documentTitle: 'Numbering',
      chapters: [CHAPTER],
      bibliography: [],
      images: IMAGES,
      citeKeys: {},
      bibtex: '',
      bibStyle: 'authoryear',
      styleLabel: 'APA 7th edition',
      exportedOn: '2026-10-09',
    });
    const main = String(files.find((f) => f.path === 'main.tex')?.data);
    expect(main).not.toContain('UNACCEPTED DRAFT');
    const labelAfter = (caption: string) =>
      main.match(new RegExp(String.raw`\\caption\{${caption}\}\s*\\label\{([^}]+)\}`))?.[1];
    const fig = labelAfter('Main figure');
    const tab = labelAfter('Main table');
    const list = labelAfter('In a list');
    expect(fig).toBeDefined();
    const after = main.split('\n').find((l) => l.startsWith('Again')) ?? '';
    expect(after).toContain(String.raw`\ref{${fig}}`);
    expect(after).toContain(String.raw`\ref{${tab}}`);
    expect(after).toContain(String.raw`\ref{${list}}`);
  });
});

// Keep the helper honest: it must find numbers in a reference line and not in a caption line.
describe('the test’s own reading', () => {
  it('reads reference numbers', () => {
    expect(refNumbers('see Figure 3.2 and Figure 3.1', 'Figure')).toEqual(['3.2', '3.1']);
  });
});

describe('a chapter titled only "Chapter 1" (QA 2026-10-09)', () => {
  it('prints one title line, not the label and then the same words again', async () => {
    const content = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body.' }] }],
    };
    const xml = documentXml(
      await thesisToDocx({
        spec: SPEC,
        details: DETAILS,
        documentTitle: 'Untitled',
        chapters: [{ id: 'c1', title: 'Chapter 1', order: 1, content, renderedMap: {} }],
        bibliography: [],
      }),
    );
    const lines = paragraphsOf(xml).filter((l) => /^chapter 1$/i.test(l.trim()));
    expect(lines).toHaveLength(1);
    // Black, not Word's blue Heading 1.
    expect(xml).toContain('<w:color w:val="000000"/>');
  });

  it('still prints the label above a real title', async () => {
    const xml = documentXml(
      await thesisToDocx({
        spec: SPEC,
        details: DETAILS,
        documentTitle: 'Titled',
        chapters: [CHAPTER],
        bibliography: [],
        images: IMAGES as never,
      }),
    );
    const lines = paragraphsOf(xml);
    expect(lines.some((l) => /^chapter 3$/i.test(l.trim()))).toBe(true);
    expect(lines.some((l) => /^results$/i.test(l.trim()))).toBe(true);
  });
});
