/**
 * "Import from Word" conversion (2026-10-04): mammoth's HTML to chapters in the editor's JSON.
 * Pure — no containers. The integration half is `word-import.spec.ts`.
 */

import { docxToHtml } from '@tc/retrieval';
import { thesisExtensions } from '@tc/ui';
import { getSchema } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import {
  bodyWords,
  chapterDoc,
  countCitationLike,
  htmlToChapters,
  isReferencesHeading,
  type PmNode,
} from '../src/modules/chapters/docx-chapters.js';
import { buildWord, heading2, para, thesisWord } from './_word.js';

const schema = getSchema(
  thesisExtensions({
    ghostText: {
      chapterId: 'test',
      request: () => {
        throw new Error('not in tests');
      },
    },
    resizableTables: false,
  }),
);

function find(nodes: readonly PmNode[], type: string): PmNode[] {
  const out: PmNode[] = [];
  const walk = (node: PmNode) => {
    if (node.type === type) out.push(node);
    for (const child of node.content ?? []) walk(child);
  };
  for (const node of nodes) walk(node);
  return out;
}

describe('htmlToChapters', () => {
  it('splits a real Word file at Heading 1 and keeps what the editor can hold', async () => {
    const { html, images } = await docxToHtml(await thesisWord());
    const result = htmlToChapters(html, 'thesis');

    expect(images).toBe(1);
    expect(result.splitAtHeadings).toBe(true);
    expect(result.chapters.map((c) => [c.title, c.preamble])).toEqual([
      ['Front matter', true],
      ['Introduction', false],
      ['Methods', false],
    ]);

    const intro = result.chapters[1];
    expect(intro?.sections).toEqual(['Background']);
    const blocks = intro?.blocks ?? [];
    expect(find(blocks, 'heading')[0]).toMatchObject({ attrs: { level: 2 } });
    expect(find(blocks, 'bulletList')).toHaveLength(1);
    expect(find(blocks, 'listItem')).toHaveLength(2);
    expect(find(blocks, 'tableRow')).toHaveLength(2);
    expect(find(blocks, 'footnote')).toEqual([
      { type: 'footnote', attrs: { text: 'Central Ground Water Board figures.' } },
    ]);
    const bold = find(blocks, 'text').find((t) => t.text === 'falling');
    expect(bold?.marks).toEqual([{ type: 'bold' }]);
    // The picture is counted by the caller and never reaches the document.
    expect(find(blocks, 'image')).toEqual([]);

    expect(result.footnotes).toBe(1);
    expect(result.tables).toBe(1);
    // "(Kumar, 2021)", "Rao (2019)", "[3]".
    expect(result.citationLike).toBe(3);

    // Every chapter opens in the editor: the editor's own schema accepts it.
    for (const chapter of result.chapters) {
      expect(() => schema.nodeFromJSON(chapterDoc(chapter)).check()).not.toThrow();
    }
  });

  it('makes a file with no Heading 1 one chapter, named by the caller', async () => {
    const { html } = await docxToHtml(
      await buildWord([para('Draft notes on irrigation.'), heading2('Sites'), para('Three.')]),
    );
    const result = htmlToChapters(html, 'my draft');
    expect(result.splitAtHeadings).toBe(false);
    expect(result.chapters).toHaveLength(1);
    expect(result.chapters[0]).toMatchObject({
      title: 'my draft',
      preamble: false,
      sections: ['Sites'],
    });
  });

  it('leaves out an empty preamble and names an untitled chapter by its number', () => {
    const result = htmlToChapters('<h1></h1><p>One.</p><h1>Two</h1><p>Two.</p>', 'x');
    expect(result.chapters.map((c) => c.title)).toEqual(['Chapter 1', 'Two']);
  });

  it('starts a list item with a paragraph and keeps merged cells', () => {
    const result = htmlToChapters(
      '<h1>A</h1><ul><li><ul><li>inner</li></ul></li></ul><table><tr><td colspan="2"><p>wide</p></td></tr></table>',
      'x',
    );
    const blocks = result.chapters[0]?.blocks ?? [];
    expect(find(blocks, 'listItem')[0]?.content?.[0]).toEqual({ type: 'paragraph' });
    expect(find(blocks, 'tableCell')[0]?.attrs).toMatchObject({ colspan: 2, rowspan: 1 });
    expect(() =>
      schema.nodeFromJSON(chapterDoc(result.chapters[0] as never)).check(),
    ).not.toThrow();
  });

  it('keeps only web links as links', () => {
    const result = htmlToChapters(
      '<h1>A</h1><p><a href="https://example.org">site</a> <a href="javascript:alert(1)">x</a> <a id="_Toc1"></a>end</p>',
      'x',
    );
    const texts = find(result.chapters[0]?.blocks ?? [], 'text');
    expect(texts.find((t) => t.text === 'site')?.marks).toEqual([
      { type: 'link', attrs: { href: 'https://example.org' } },
    ]);
    expect(texts.find((t) => t.text === 'x')?.marks).toBeUndefined();
  });
});

describe('references sections (R34, ADR-0113)', () => {
  it('finds a References chapter, counts its entries, and has none in a file without one', async () => {
    const result = htmlToChapters(
      '<h1>Introduction</h1><p>Wells are deeper (Kumar, 2021).</p><h1>References</h1><p>Kumar, A. (2021). Falling tables.</p><p>Rao, S. (2019). Borewells.</p>',
      'x',
    );
    expect(result.references).toEqual([
      { heading: 'References', chapter: 'References', entries: 2 },
    ]);
    expect(result.citationLike).toBe(1);
    // The list still comes across as the student's text.
    expect(result.chapters.map((c) => c.title)).toEqual(['Introduction', 'References']);
    const { html } = await docxToHtml(await thesisWord());
    expect(htmlToChapters(html, 'thesis').references).toEqual([]);
  });

  it('finds a Heading 2 and a plain paragraph inside a chapter, each ending at the next heading', () => {
    const result = htmlToChapters(
      [
        '<h1>Conclusion</h1><p>As before [1].</p>',
        '<h2>Bibliography</h2><ol><li>[1] A. Kumar, Falling tables, 2021.</li><li>[2] S. Rao, Borewells, 2019.</li></ol>',
        '<h2>Further work</h2><p>Extend it [2].</p>',
        '<h1>Chapter 2</h1><p>Seasons differ (Sen, 2020).</p>',
        '<p><strong>REFERENCES</strong></p><p>Sen, K. (2020). Monsoon wells.</p>',
        '<h3>Notes</h3><p>Field notes from Kolar.</p>',
      ].join(''),
      'x',
    );
    expect(result.references).toEqual([
      { heading: 'Bibliography', chapter: 'Conclusion', entries: 2 },
      { heading: 'REFERENCES', chapter: 'Chapter 2', entries: 1 },
    ]);
    // "[1]" and "[2]" open entries of the list; only the three in the text are citations.
    expect(result.citationLike).toBe(3);
  });

  it('knows a references heading by its name, numbered or not, and not a sentence that mentions one', () => {
    for (const heading of [
      'References',
      'REFERENCES:',
      '7. References',
      'Chapter 7: References',
      'VII. Bibliography',
      'Selected bibliography',
      'Works Cited',
      'Literature cited',
      'Reference list',
    ]) {
      expect(isReferencesHeading(heading), heading).toBe(true);
    }
    for (const line of [
      'References to the old scheme are common in the district reports.',
      'Methods',
      'Referees',
      'Sources',
      'A bibliography of irrigation',
    ]) {
      expect(isReferencesHeading(line), line).toBe(false);
    }
  });

  it('does not take a title the import made up for a references heading', () => {
    // A file with no Heading 1 is named after the file, which says nothing about its content.
    const result = htmlToChapters('<p>Wells are deeper [1].</p>', 'References');
    expect(result.references).toEqual([]);
    expect(result.citationLike).toBe(1);
  });
});

describe('countCitationLike', () => {
  it('counts the shapes a typed citation takes, and not ordinary brackets', () => {
    expect(countCitationLike('as shown (Kumar, 2021; Sen et al., 2020a).')).toBe(1);
    expect(countCitationLike('Kumar et al. (2021) found')).toBe(1);
    expect(countCitationLike('see [1, 4–6] and [12]')).toBe(2);
    expect(countCitationLike('in (2021) and (n = 40) and [a]')).toBe(0);
  });
});

describe('bodyWords', () => {
  it('does not count the chapter title', () => {
    expect(
      bodyWords({
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Chapter 1' }] },
          { type: 'paragraph' },
        ],
      }),
    ).toBe(0);
  });
});
