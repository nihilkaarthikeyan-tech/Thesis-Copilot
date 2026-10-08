/**
 * R33 (ADR-0120): the student's font style in the chapter `.docx` and the web page export. The
 * thesis `.docx` keeps the template's font, which the compliance check reads.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FONT_STYLE_DOCX, readFontStyle, readTemplateSpec, readThesisDetails } from '@tc/types';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { chapterToDocx } from '../src/docx.js';
import { thesisToHtml } from '../src/html.js';
import { thesisToDocx } from '../src/thesis.js';

const CONTENT = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Methods' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'A sentence.' }] },
  ],
};

async function stylesOf(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  return (await zip.file('word/styles.xml')?.async('string')) ?? '';
}

/** The document defaults' run properties, where a document-wide font is set. */
const docDefaults = (styles: string) =>
  styles.slice(styles.indexOf('<w:docDefaults>'), styles.indexOf('</w:docDefaults>'));

describe('the font style in a chapter .docx', () => {
  it('serif is Times New Roman and sans is Arial, document-wide', async () => {
    for (const [style, font] of [
      ['serif', 'Times New Roman'],
      ['sans', 'Arial'],
    ] as const) {
      expect(FONT_STYLE_DOCX[style]).toBe(font);
      const styles = await stylesOf(
        await chapterToDocx(CONTENT, { title: 'Methods', font: FONT_STYLE_DOCX[style] ?? '' }),
      );
      expect(docDefaults(styles)).toContain(`w:ascii="${font}"`);
    }
  });

  it('default leaves Word on its own font', async () => {
    expect(FONT_STYLE_DOCX.default).toBeNull();
    const styles = await stylesOf(await chapterToDocx(CONTENT, { title: 'Methods' }));
    expect(docDefaults(styles)).not.toContain('Times New Roman');
    expect(docDefaults(styles)).not.toContain('w:ascii="Arial"');
  });

  it('reads an unknown or missing setting as the default', () => {
    expect(readFontStyle(undefined)).toBe('default');
    expect(readFontStyle('comic')).toBe('default');
    expect(readFontStyle('serif')).toBe('serif');
  });
});

const SPEC = readTemplateSpec(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../db/prisma/seed-data/example-template.json', import.meta.url)),
      'utf8',
    ),
  ),
);
const input = {
  spec: SPEC,
  details: readThesisDetails({ studentName: 'A. Kumar' }),
  documentTitle: 'Drip irrigation',
  chapters: [{ id: 'c1', title: 'Methods', order: 1, content: CONTENT, renderedMap: {} }],
};

describe('the font style in the web page', () => {
  it('sans sets the page in a sans-serif; default and serif keep the serif', () => {
    const page = (fontStyle?: 'default' | 'serif' | 'sans') =>
      thesisToHtml({
        ...input,
        bibliography: [],
        exportedOn: '2026-10-08',
        ...(fontStyle ? { fontStyle } : {}),
      });
    const sansRule = "body { font-family: system-ui, 'Segoe UI', Roboto, Arial, sans-serif; }";
    expect(page('sans')).toContain(sansRule);
    expect(page('serif')).not.toContain(sansRule);
    expect(page()).not.toContain(sansRule);
    expect(page()).toContain("font: 17px/1.65 Georgia, 'Times New Roman', serif");
  });
});

describe('the thesis .docx', () => {
  it('keeps the template’s font whatever the student reads in', async () => {
    const styles = await stylesOf(await thesisToDocx({ ...input, bibliography: [] }));
    expect(docDefaults(styles)).toContain(`w:ascii="${SPEC.font.body}"`);
  });
});
