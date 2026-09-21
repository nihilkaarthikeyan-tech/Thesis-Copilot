/**
 * What a table cell is allowed to contain, and what reaches the submitted file.
 *
 * `chapterToDocx` recurses into a cell and renders its blocks; `thesisToDocx` flattened the whole
 * cell to inline runs. An `image` has no runs, so a figure a student had put inside a table was
 * silently absent from the thesis — while the chapter export of the same document showed it. Two
 * exporters disagreeing about one document is worse than either one being wrong, because whichever
 * you check is the one that looks right.
 *
 * Found by exporting a whole thesis in a browser and opening the `.docx`, which is the only way
 * this class of fault has ever been found in this repository.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { readTemplateSpec, readThesisDetails } from '@tc/types';
import { describe, expect, it } from 'vitest';
import { chapterToDocx } from '../src/docx.js';
import { thesisToDocx } from '../src/thesis.js';

function documentXml(buffer: Buffer): { xml: string; media: number } {
  let offset = 0;
  let xml = '';
  let media = 0;
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
    if (name.startsWith('word/media/')) media++;
    if (name === 'word/document.xml') {
      const data = buffer.subarray(dataStart, dataStart + compressedSize);
      xml = method === 0 ? data.toString('utf8') : inflateRawSync(data).toString('utf8');
    }
    offset = dataStart + compressedSize;
  }
  return { xml, media };
}

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

/** A 1x1 PNG. Small enough to inline, real enough for `docx` to embed. */
const PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
);

const IMAGES = {
  'figures/a/b/plot.png': { data: PNG, width: 120, height: 80, type: 'png' },
} as const;

const cellWithFigure = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Results' }] },
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableCell',
              content: [
                { type: 'image', attrs: { key: 'figures/a/b/plot.png', alt: 'plot.png' } },
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Yield by district' }],
                },
              ],
            },
            {
              type: 'tableCell',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'First line' }] },
                { type: 'paragraph', content: [{ type: 'text', text: 'Second line' }] },
              ],
            },
          ],
        },
      ],
    },
  ],
};

const chapters = [
  { id: 'ch1', title: 'Results', order: 1, content: cellWithFigure, renderedMap: {} },
];

describe('a figure inside a table cell', () => {
  it('is embedded in the whole-thesis export, not dropped', async () => {
    const { xml, media } = documentXml(
      await thesisToDocx({
        spec: SPEC,
        details: DETAILS,
        documentTitle: 'Yield',
        chapters,
        bibliography: [],
        images: IMAGES as never,
      }),
    );
    expect(media).toBeGreaterThan(0);
    expect(xml).toContain('<w:drawing>');
    expect(xml).toContain('Yield by district');
  });

  it('agrees with the chapter export, which never had the bug', async () => {
    const { media } = documentXml(
      await chapterToDocx(cellWithFigure, {
        title: 'Results',
        renderedMap: {},
        images: IMAGES as never,
      }),
    );
    expect(media).toBeGreaterThan(0);
  });

  it('leaves a named placeholder when the bytes could not be read', async () => {
    // An export running into a deadline must not fail over one unreadable picture, but the gap
    // has to be visible — a caption over nothing is how this was missed the first time.
    const { xml, media } = documentXml(
      await thesisToDocx({
        spec: SPEC,
        details: DETAILS,
        documentTitle: 'Yield',
        chapters,
        bibliography: [],
        images: {},
      }),
    );
    expect(media).toBe(0);
    expect(xml).toContain('[plot.png]');
  });
});

describe('a display equation', () => {
  it('reaches the whole-thesis file, as its LaTeX source', async () => {
    // The chapter loop has always handled this; the test is here because a browser run showed an
    // equation missing from the exported thesis and the exporter was the first place anyone
    // looked. It was not the exporter — the editor was destroying the node before the save, see
    // `packages/ui/src/editor/insert-block.ts`. Worth pinning either way.
    const withMath = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Model' }] },
        { type: 'mathBlock', attrs: { latex: 'E = mc^2' } },
      ],
    };
    const { xml } = documentXml(
      await thesisToDocx({
        spec: SPEC,
        details: DETAILS,
        documentTitle: 'Model',
        chapters: [{ id: 'ch1', title: 'Model', order: 1, content: withMath, renderedMap: {} }],
        bibliography: [],
      }),
    );
    expect(xml).toContain('E = mc^2');
  });

  it('reaches it from inside a table cell too', async () => {
    const inCell = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Model' }] },
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [{ type: 'mathBlock', attrs: { latex: 'a^2 + b^2 = c^2' } }],
                },
              ],
            },
          ],
        },
      ],
    };
    const { xml } = documentXml(
      await thesisToDocx({
        spec: SPEC,
        details: DETAILS,
        documentTitle: 'Model',
        chapters: [{ id: 'ch1', title: 'Model', order: 1, content: inCell, renderedMap: {} }],
        bibliography: [],
      }),
    );
    expect(xml).toContain('a^2 + b^2 = c^2');
  });
});

describe('two paragraphs in one cell', () => {
  it('stay two paragraphs rather than running together', async () => {
    const { xml } = documentXml(
      await thesisToDocx({
        spec: SPEC,
        details: DETAILS,
        documentTitle: 'Yield',
        chapters,
        bibliography: [],
        images: IMAGES as never,
      }),
    );
    // Flattened to one run-stream they would have been adjacent inside a single `<w:p>`.
    expect(xml).not.toContain('First lineSecond line');
    expect(xml).toContain('First line');
    expect(xml).toContain('Second line');
  });
});
