/**
 * `.docx` comment import — PRD FR-7.3, PHASES v2 B4.2.
 *
 * The fixtures below are built as real Word packages, so the parser is read against the XML Word
 * writes rather than against a shape invented to match it. What matters most is the anchoring:
 * a comment's value is that it points at a sentence, and a comment imported without its quoted
 * text lands in the review queue as a remark about nothing in particular.
 */

import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { readDocxComments } from '../src/extract/docx-comments.js';

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

async function docx(documentBody: string, comments?: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.folder('word')?.file(
    'document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${NS}><w:body>${documentBody}</w:body></w:document>`,
  );
  if (comments !== undefined) {
    zip.folder('word')?.file(
      'comments.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments ${NS}>${comments}</w:comments>`,
    );
  }
  return new Uint8Array(await zip.generateAsync({ type: 'nodebuffer' }));
}

const anchored = (id: string, text: string) =>
  `<w:p><w:commentRangeStart w:id="${id}"/><w:r><w:t>${text}</w:t></w:r><w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r></w:p>`;

const comment = (id: string, author: string, body: string, attrs = '') =>
  `<w:comment w:id="${id}" w:author="${author}" w:initials="XX" w:date="2026-08-30T10:15:00Z"${attrs}><w:p><w:r><w:t>${body}</w:t></w:r></w:p></w:comment>`;

const QUOTE = 'Open drying loses an estimated fifth of the catch.';

describe('reading the comments', () => {
  it('reads the author, date, body and the text the comment was attached to', async () => {
    const file = await docx(
      anchored('0', QUOTE),
      comment('0', 'Dr S Raman', 'Where does the fifth come from?'),
    );
    const { comments } = await readDocxComments(file);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toEqual({
      wordId: '0',
      author: 'Dr S Raman',
      initials: 'XX',
      date: '2026-08-30T10:15:00Z',
      body: 'Where does the fifth come from?',
      quotedText: QUOTE,
    });
  });

  it('keeps a paragraph break inside a comment', async () => {
    const file = await docx(
      anchored('0', QUOTE),
      `<w:comment w:id="0" w:author="A"><w:p><w:r><w:t>First point.</w:t></w:r></w:p><w:p><w:r><w:t>Second point.</w:t></w:r></w:p></w:comment>`,
    );
    const { comments } = await readDocxComments(file);
    // A guide who wrote two paragraphs meant two; the review queue shows the body verbatim.
    expect(comments[0]?.body).toBe('First point.\nSecond point.');
  });

  it('joins the runs Word splits a sentence into', async () => {
    // Word breaks a run at every formatting change, so one sentence is often three <w:t>s.
    const file = await docx(
      `<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>Open drying </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>loses</w:t></w:r><w:r><w:t> a fifth.</w:t></w:r><w:commentRangeEnd w:id="0"/></w:p>`,
      comment('0', 'A', 'Cite this.'),
    );
    const { comments } = await readDocxComments(file);
    expect(comments[0]?.quotedText).toBe('Open drying loses a fifth.');
  });

  it('decodes XML entities in both the body and the quote', async () => {
    const file = await docx(
      anchored('0', 'Wind &amp; solar &lt;5 kW'),
      comment('0', 'Dr O&apos;Brien', 'Where does the &quot;fifth&quot; come from?'),
    );
    const { comments } = await readDocxComments(file);
    expect(comments[0]?.body).toBe('Where does the "fifth" come from?');
    expect(comments[0]?.quotedText).toBe('Wind & solar <5 kW');
    expect(comments[0]?.author).toBe("Dr O'Brien");
  });

  it('handles overlapping ranges, which two guides on one paragraph produce', async () => {
    const file = await docx(
      `<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>Open drying loses </w:t></w:r><w:commentRangeStart w:id="1"/><w:r><w:t>a fifth of the catch.</w:t></w:r><w:commentRangeEnd w:id="0"/><w:commentRangeEnd w:id="1"/></w:p>`,
      comment('0', 'A', 'First.') + comment('1', 'B', 'Second.'),
    );
    const { comments } = await readDocxComments(file);
    expect(comments.find((c) => c.wordId === '0')?.quotedText).toBe(
      'Open drying loses a fifth of the catch.',
    );
    expect(comments.find((c) => c.wordId === '1')?.quotedText).toBe('a fifth of the catch.');
  });

  it('keeps a comment with no range, quoting nothing', async () => {
    // Word allows a comment on a collapsed cursor. It still says something, so it is imported
    // and shown at chapter level rather than dropped.
    const file = await docx(
      '<w:p><w:r><w:t>A paragraph.</w:t></w:r></w:p>',
      comment('0', 'A', 'A general remark.'),
    );
    const { comments } = await readDocxComments(file);
    expect(comments).toHaveLength(1);
    expect(comments[0]?.quotedText).toBe(null);
  });

  it('skips an empty balloon someone opened and left', async () => {
    const file = await docx(
      anchored('0', QUOTE),
      comment('0', 'A', 'A real remark.') +
        `<w:comment w:id="1" w:author="A"><w:p><w:r><w:t></w:t></w:r></w:p></w:comment>`,
    );
    const { comments } = await readDocxComments(file);
    expect(comments.map((c) => c.wordId)).toEqual(['0']);
  });

  it('falls back to "Unknown" rather than inventing an author', async () => {
    const file = await docx(
      anchored('0', QUOTE),
      `<w:comment w:id="0"><w:p><w:r><w:t>A remark.</w:t></w:r></w:p></w:comment>`,
    );
    const { comments } = await readDocxComments(file);
    expect(comments[0]?.author).toBe('Unknown');
    expect(comments[0]?.initials).toBe(null);
    expect(comments[0]?.date).toBe(null);
  });
});

describe('tracked changes', () => {
  it('counts insertions and deletions without importing them', async () => {
    // FR-7.3 names them beside comments, but a revision is an edit rather than a remark, and
    // importing one as a comment would put an edit into the review queue dressed as a question.
    const file = await docx(
      `${anchored('0', QUOTE)}<w:p><w:ins w:id="90" w:author="A"><w:r><w:t> inserted</w:t></w:r></w:ins><w:del w:id="91" w:author="A"><w:r><w:delText>removed</w:delText></w:r></w:del></w:p>`,
      comment('0', 'A', 'A remark.'),
    );
    const result = await readDocxComments(file);
    expect(result.trackedChanges).toBe(2);
    expect(result.comments).toHaveLength(1);
  });

  it('reports them for a file that has changes and no comments', async () => {
    const file = await docx(
      `<w:p><w:ins w:id="90" w:author="A"><w:r><w:t>x</w:t></w:r></w:ins></w:p>`,
    );
    const result = await readDocxComments(file);
    expect(result).toEqual({ comments: [], trackedChanges: 1 });
  });
});

describe('files that are not what they claim', () => {
  it('returns nothing rather than an error for a document with no comments', async () => {
    // "This file has no comments" is a fact the caller reports; an error would read as a broken
    // upload and send the student back to their guide for a file that is fine.
    const result = await readDocxComments(await docx('<w:p><w:r><w:t>Plain.</w:t></w:r></w:p>'));
    expect(result).toEqual({ comments: [], trackedChanges: 0 });
  });

  it('refuses a zip that is not a Word document, naming what is missing', async () => {
    const zip = new JSZip();
    zip.file('hello.txt', 'not a docx');
    const bytes = new Uint8Array(await zip.generateAsync({ type: 'nodebuffer' }));
    await expect(readDocxComments(bytes)).rejects.toThrow(/word\/document\.xml/);
  });

  it('refuses bytes that are not a zip at all', async () => {
    await expect(readDocxComments(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow();
  });
});
