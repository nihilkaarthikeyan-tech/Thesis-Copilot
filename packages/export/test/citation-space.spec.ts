/**
 * ADR-0155 item 5 (the Word test, 2026-10-16): the exported thesis read
 * "challenges(Mohammed & Maheswari, 2025)". A bracketed citation straight after a word gets a
 * space; one after a space or an opening bracket does not. Read from the file a reader opens.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readTemplateSpec, readThesisDetails } from '@tc/types';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { spaceBeforeCitation } from '../src/clusters.js';
import { chapterToDocx } from '../src/docx.js';
import { thesisToHtml } from '../src/html.js';
import { thesisToDocx } from '../src/thesis.js';

const SPEC = readTemplateSpec(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../db/prisma/seed-data/example-template.json', import.meta.url)),
      'utf8',
    ),
  ),
);

const cite = (key: string) => ({
  type: 'citation',
  attrs: { key, sourceId: 's1', role: 'parenthetical' },
});
const LABELS = { n1: '(Mohammed & Maheswari, 2025)', n2: '(Bagla, 2026)', n3: '(Bagla, 2026)' };

/** As stored by the faulty suggestion: no space before the first citation. */
const CONTENT = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'structural challenges' },
        cite('n1'),
        { type: 'text', text: '. Households hesitate ' },
        cite('n2'),
        { type: 'text', text: '. A note (see ' },
        cite('n3'),
        { type: 'text', text: ').' },
      ],
    },
  ],
};

const visibleText = (xml: string) =>
  [
    ...xml
      .replace(/<w:instrText\b[^>]*>.*?<\/w:instrText>/g, '')
      .matchAll(/<w:t\b[^>]*>(.*?)<\/w:t>/g),
  ]
    .map((m) => m[1])
    .join('')
    .replace(/&amp;/g, '&');

const documentXml = async (buffer: Buffer) =>
  (await (await JSZip.loadAsync(buffer)).file('word/document.xml')?.async('string')) ?? '';

const EXPECTED =
  'structural challenges (Mohammed & Maheswari, 2025). Households hesitate (Bagla, 2026). A note (see (Bagla, 2026)).';

describe('a space before a citation (ADR-0155)', () => {
  it('the rule', () => {
    const nodes = CONTENT.content[0]?.content ?? [];
    expect(spaceBeforeCitation(nodes, 1, LABELS.n1)).toBe(true);
    expect(spaceBeforeCitation(nodes, 3, LABELS.n2)).toBe(false);
    expect(spaceBeforeCitation(nodes, 5, LABELS.n3)).toBe(false);
    // A superscript number sits on the word.
    expect(spaceBeforeCitation(nodes, 1, '¹')).toBe(false);
  });

  it('in a chapter .docx and the thesis .docx', async () => {
    const chapter = visibleText(
      await documentXml(await chapterToDocx(CONTENT, { title: 'Intro', renderedMap: LABELS })),
    );
    expect(chapter).toContain(EXPECTED);
    const whole = visibleText(
      await documentXml(
        await thesisToDocx({
          spec: SPEC,
          details: readThesisDetails({}),
          documentTitle: 'A thesis',
          chapters: [{ id: 'c1', title: 'Intro', order: 1, content: CONTENT, renderedMap: LABELS }],
          bibliography: [],
        }),
      ),
    );
    expect(whole).toContain(EXPECTED);
  });

  it('in the HTML export', () => {
    const html = thesisToHtml({
      spec: SPEC,
      details: readThesisDetails({}),
      documentTitle: 'A thesis',
      chapters: [{ id: 'c1', title: 'Intro', order: 1, content: CONTENT, renderedMap: LABELS }],
      bibliography: [],
      exportedOn: '2026-10-16',
    });
    const text = html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');
    expect(text).toContain(EXPECTED);
  });
});
