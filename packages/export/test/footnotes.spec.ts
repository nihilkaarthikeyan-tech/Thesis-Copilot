/**
 * Footnotes in every export (2026-09-25): a real Word footnote, `\footnote`, and a numbered note
 * in the web page, numbered through the thesis.
 */

import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { chapterToDocx } from '../src/docx.js';
import { footnoteText } from '../src/footnotes.js';

const note = (text: string) => ({ type: 'footnote', attrs: { text } });
const doc = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Uptake stayed low' },
        note('The 2020 subsidy change came after the survey.'),
        { type: 'text', text: ' in both districts' },
        note('Data from the district offices.'),
        { type: 'text', text: '.' },
      ],
    },
  ],
};

describe('a footnote in the Word export', () => {
  it('is a real footnote: a reference in the line and the note in footnotes.xml', async () => {
    const zip = await JSZip.loadAsync(await chapterToDocx(doc, { title: 'Results' }));
    const body = (await zip.file('word/document.xml')?.async('string')) ?? '';
    const notes = (await zip.file('word/footnotes.xml')?.async('string')) ?? '';
    expect(body.match(/<w:footnoteReference w:id="\d+"\/>/g)).toHaveLength(2);
    expect(notes).toContain('The 2020 subsidy change came after the survey.');
    expect(notes).toContain('Data from the district offices.');
    // The note text is not also printed in the line.
    expect(body).not.toContain('district offices');
  });

  it('numbers each export from one, however many exports have run', async () => {
    const first = await JSZip.loadAsync(await chapterToDocx(doc, { title: 'A' }));
    const second = await JSZip.loadAsync(await chapterToDocx(doc, { title: 'B' }));
    const ids = async (zip: JSZip) =>
      [
        ...((await zip.file('word/document.xml')?.async('string')) ?? '').matchAll(
          /<w:footnoteReference w:id="(\d+)"\/>/g,
        ),
      ].map((m) => m[1]);
    expect(await ids(second)).toEqual(await ids(first));
  });
});

describe('an empty footnote', () => {
  it('still takes its number, and says it is empty rather than vanishing', () => {
    expect(footnoteText({ attrs: { text: '   ' } })).toBe('[empty footnote]');
  });
});
