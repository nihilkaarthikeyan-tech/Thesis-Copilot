/**
 * A pending AI draft never reaches the submitted thesis.
 *
 * Found on 2026-09-24 while building the LaTeX and HTML exporters from this one: the whole-thesis
 * builder had no case for `draftBlock`, and its fallback wrote the draft's text into the `.docx` —
 * and so into the PDF a student submits — although the student had never accepted it. The chapter
 * export always skipped drafts; the thesis export, the one that matters, did not.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { readTemplateSpec, readThesisDetails } from '@tc/types';
import { describe, expect, it } from 'vitest';
import { thesisToDocx, withoutPendingDrafts } from '../src/thesis.js';

function documentXml(buffer: Buffer): string {
  let offset = 0;
  while (offset < buffer.length - 4) {
    if (buffer.readUInt32LE(offset) !== 0x04_03_4b_50) {
      offset++;
      continue;
    }
    const method = buffer.readUInt16LE(offset + 8);
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString('latin1');
    const start = offset + 30 + nameLength + extraLength;
    if (name === 'word/document.xml') {
      const data = buffer.subarray(start, start + size);
      return method === 0 ? data.toString('utf8') : inflateRawSync(data).toString('utf8');
    }
    offset = start + size;
  }
  return '';
}

const SPEC = readTemplateSpec(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../db/prisma/seed-data/example-template.json', import.meta.url)),
      'utf8',
    ),
  ),
);

const draft = (text: string) => ({
  type: 'draftBlock',
  attrs: { draftId: 'd1', status: 'pending' },
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text },
        { type: 'needsSourceNote', attrs: { text: 'the yield figure' } },
      ],
    },
  ],
});

const content = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Results' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'The student wrote this.' }] },
    draft('An unaccepted drafted paragraph at the top level.'),
    {
      type: 'bulletList',
      content: [{ type: 'listItem', content: [draft('An unaccepted draft inside a list.')] }],
    },
  ],
};

describe('a pending AI draft', () => {
  it('is not in the thesis the student submits, wherever it sits', async () => {
    const xml = documentXml(
      await thesisToDocx({
        spec: SPEC,
        details: readThesisDetails({}),
        documentTitle: 'A thesis',
        chapters: [{ id: 'c1', title: 'Results', order: 1, content, renderedMap: {} }],
        bibliography: [],
      }),
    );
    expect(xml).toContain('The student wrote this.');
    expect(xml).not.toContain('unaccepted');
    expect(xml).not.toContain('NEEDS SOURCE');
  });

  it('is removed at every depth, and nothing else is', () => {
    const stripped = withoutPendingDrafts(content) as typeof content;
    expect(JSON.stringify(stripped)).not.toContain('draftBlock');
    expect(JSON.stringify(stripped)).toContain('The student wrote this.');
    expect(stripped.content).toHaveLength(3);
  });
});
