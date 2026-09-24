/**
 * Export — PRD FR-8.1, FR-8.6, §12, PHASES 4.7 and 4.8.
 *
 * The `.docx` assertions open the produced file as a zip and read `word/document.xml`, because a
 * file that "builds" but will not open is the failure that actually happens with this format.
 * PHASES 4.7 asks for the LibreOffice conversion as the final proof; that runs separately (see
 * `docs/BUILD_LOG.md`) since it needs `soffice` on the machine.
 */

import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { aiShare, totalWords, type UsageReport, usageToCsv, usageToDocx } from '../src/ai-usage.js';
import { chapterToDocx } from '../src/docx.js';

/** Reads `word/document.xml` out of a .docx, which is a zip. */
function documentXml(buffer: Buffer): string {
  // Minimal local-file-header walk: enough to find one entry without a zip dependency.
  let offset = 0;
  while (offset < buffer.length - 4) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) {
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
      // Zip entries are raw deflate, with no zlib header.
      return method === 0 ? data.toString('utf8') : inflateRawSync(data).toString('utf8');
    }
    offset = dataStart + compressedSize;
  }
  throw new Error('word/document.xml not found in the .docx');
}

const doc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Cost barriers' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Upfront cost dominated the responses ' },
        { type: 'citation', attrs: { key: 'c_a', sourceId: 'src-1' } },
        { type: 'text', text: '.' },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A bullet' }] }],
        },
      ],
    },
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableCell',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cell one' }] }],
            },
          ],
        },
      ],
    },
  ],
};

describe('chapterToDocx (FR-8.1)', () => {
  it('produces a real .docx containing the chapter', async () => {
    const buffer = await chapterToDocx(doc, {
      title: 'Literature review',
      renderedMap: { c_a: '(Kumar et al., 2021)' },
    });

    expect(buffer.subarray(0, 2).toString()).toBe('PK');
    const xml = documentXml(buffer);
    expect(xml).toContain('Literature review');
    expect(xml).toContain('Cost barriers');
    expect(xml).toContain('Upfront cost dominated');
    expect(xml).toContain('A bullet');
    expect(xml).toContain('Cell one');
  });

  it('renders a citation with the label the editor showed', async () => {
    const xml = documentXml(
      await chapterToDocx(doc, {
        title: 'Chapter',
        renderedMap: { c_a: '(Kumar et al., 2021)' },
      }),
    );
    // The document stores only ids; the exported file must say what the student saw.
    expect(xml).toContain('(Kumar et al., 2021)');
    expect(xml).not.toContain('c_a');
  });

  it('marks a citation whose source is gone rather than dropping it silently', async () => {
    const xml = documentXml(await chapterToDocx(doc, { title: 'Chapter' }));
    expect(xml).toContain('(source missing)');
  });

  it('appends the bibliography under its own heading', async () => {
    const xml = documentXml(
      await chapterToDocx(doc, {
        title: 'Chapter',
        bibliography: ['Kumar, A. (2021). Solar adoption. Energy Policy.'],
      }),
    );
    expect(xml).toContain('References');
    expect(xml).toContain('Kumar, A. (2021)');
  });

  it('never exports an unaccepted draft', async () => {
    const withDraft = {
      type: 'doc',
      content: [
        {
          type: 'draftBlock',
          attrs: { draftId: 'd1', status: 'pending' },
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'UNACCEPTED DRAFT TEXT' }] },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'Real text.' }] },
      ],
    };
    const xml = documentXml(await chapterToDocx(withDraft, { title: 'Chapter' }));
    // Text the student never approved must not reach the file they submit.
    expect(xml).not.toContain('UNACCEPTED DRAFT TEXT');
    expect(xml).toContain('Real text.');
  });

  it('keeps an unresolved needs-source note visible', async () => {
    const withNote = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'needsSourceNote', attrs: { text: 'figures for 2019' } }],
        },
      ],
    };
    const xml = documentXml(await chapterToDocx(withNote, { title: 'Chapter' }));
    expect(xml).toContain('NEEDS SOURCE: figures for 2019');
  });

  it('survives a missing image rather than writing a broken file', async () => {
    const withImage = {
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: { src: 'images/gone.png', alt: 'gone.png', caption: 'A chart' },
        },
      ],
    };
    const buffer = await chapterToDocx(withImage, { title: 'Chapter' });
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
    // The placeholder, and the caption the student wrote — never the file name.
    expect(documentXml(buffer)).toContain('[image]');
    expect(documentXml(buffer)).toContain('A chart');
    expect(documentXml(buffer)).not.toContain('gone.png');
  });
});

const report: UsageReport = {
  documentTitle: 'Barriers to rooftop solar adoption',
  from: new Date('2026-09-01T00:00:00Z'),
  to: new Date('2026-09-30T00:00:00Z'),
  chapters: [
    {
      title: 'Introduction',
      wordCounts: { HUMAN: 800, ASSIST: 100, DRAFT: 0, COMMAND: 0, HUMAN_EDITED: 100 },
      actions: 12,
    },
    {
      title: 'Literature review',
      wordCounts: { HUMAN: 400, ASSIST: 50, DRAFT: 500, COMMAND: 0, HUMAN_EDITED: 50 },
      actions: 30,
    },
  ],
};

describe('the AI-usage log (FR-8.6, §12)', () => {
  it('counts every provenance kind towards the total', () => {
    expect(totalWords(report.chapters[0]?.wordCounts ?? {})).toBe(1_000);
  });

  it('counts text the student rewrote as their own', () => {
    // That is what the HUMAN_EDITED mark is for: they took it over.
    expect(aiShare({ HUMAN: 800, ASSIST: 100, HUMAN_EDITED: 100 })).toBe(10);
    expect(aiShare({ HUMAN: 0, DRAFT: 100 })).toBe(100);
    expect(aiShare({})).toBe(0);
  });

  it('writes a CSV with a row per chapter and a total', () => {
    const csv = usageToCsv(report);
    const lines = csv.split('\n');
    expect(lines[0]).toBe(
      'chapter,human,assist,draft,command,human_edited,total_words,ai_share_percent,ai_actions',
    );
    expect(lines[1]).toBe('Introduction,800,100,0,0,100,1000,10,12');
    expect(lines.at(-1)).toBe('TOTAL,1200,150,500,0,150,2000,32.5,42');
  });

  it('escapes a chapter title containing a comma', () => {
    const csv = usageToCsv({
      ...report,
      chapters: [{ title: 'Cost, price and value', wordCounts: { HUMAN: 10 }, actions: 1 }],
    });
    expect(csv).toContain('"Cost, price and value"');
  });

  it('writes a .docx carrying the same numbers', async () => {
    const xml = documentXml(await usageToDocx(report));
    expect(xml).toContain('AI usage log');
    expect(xml).toContain('Barriers to rooftop solar adoption');
    expect(xml).toContain('2026-09-01');
    expect(xml).toContain('Literature review');
    expect(xml).toContain('32.5%');
  });

  it('says the range was not recorded rather than inventing dates', async () => {
    const xml = documentXml(await usageToDocx({ ...report, from: null, to: null }));
    expect(xml).toContain('not recorded');
  });
});
