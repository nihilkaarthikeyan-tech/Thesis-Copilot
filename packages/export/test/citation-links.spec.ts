/**
 * ADR-0055: citations that stay connected in the Word export.
 *
 * Every test opens the generated `.docx` and reads its XML, because the failure this guards
 * against is the one `fieldParagraph` had: a file that looks right in the arguments and prints
 * field codes, or nothing, when opened. The visible text of all three modes must be identical —
 * a student who picks "linked" or "Word citations" must never see different words.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CitationMode } from '@tc/types';
import { readTemplateSpec, readThesisDetails } from '@tc/types';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  bibliographyField,
  renumberBookmarks,
  wordSource,
  wordSourcesXml,
} from '../src/citation-links.js';
import { chapterToDocx } from '../src/docx.js';
import { thesisToDocx } from '../src/thesis.js';

const SPEC = readTemplateSpec(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../db/prisma/seed-data/example-template.json', import.meta.url)),
      'utf8',
    ),
  ),
);

const SOURCES = [
  {
    id: 's-kumar',
    title: 'Soil carbon & yield',
    authors: null,
    year: 2021,
    cslJson: {
      type: 'article-journal',
      title: 'Soil carbon & yield',
      author: [
        { family: 'Kumar', given: 'Anil' },
        { family: 'Rao', given: 'Meera' },
      ],
      issued: { 'date-parts': [[2021]] },
      'container-title': 'Journal of Agronomy',
      volume: '12',
      issue: '3',
      page: '45-67',
      DOI: '10.1000/agro.2021.12',
    },
  },
  {
    id: 's-who',
    title: 'Irrigation report',
    year: 2019,
    cslJson: {
      type: 'report',
      title: 'Irrigation report',
      author: [{ literal: 'World Health Organization' }],
      issued: { 'date-parts': [[2019]] },
      publisher: 'WHO',
    },
  },
];

/** Bibliography order, as citeproc returned it: WHO is not first in the source list. */
const ENTRY_SOURCES = ['s-kumar', 's-who'];
const BIBLIOGRAPHY = [
  'Kumar, A., & Rao, M. (2021). Soil carbon & yield. Journal of Agronomy, 12(3), 45–67.',
  'World Health Organization. (2019). Irrigation report. WHO.',
];

const cite = (key: string, sourceId: string, extra: Record<string, string> = {}) => ({
  type: 'citation',
  attrs: { key, sourceId, ...extra },
});

const CONTENT = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Results' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Yields rose ' },
        cite('n1', 's-kumar', { locator: '52' }),
        { type: 'text', text: ' while water use fell ' },
        cite('n2', 's-who'),
        { type: 'text', text: ' and one claim cites a deleted paper ' },
        cite('n3', 's-gone'),
        { type: 'text', text: '.' },
      ],
    },
  ],
};

const AUTHOR_DATE = {
  n1: '(Kumar & Rao, 2021, p. 52)',
  n2: '(World Health Organization, 2019)',
  n3: '(Gone, 2000)',
};
const NUMERIC = { n1: '[1, p. 52]', n2: '[2]', n3: '[3]' };
const NOTES = {
  n1: 'Anil Kumar and Meera Rao, “Soil Carbon & Yield,” Journal of Agronomy 12, no. 3 (2021): 52.',
  n2: 'World Health Organization, Irrigation Report (WHO, 2019).',
  n3: 'Gone, Something (2000).',
};

async function thesis(
  mode: CitationMode | undefined,
  renderedMap: Record<string, string> = AUTHOR_DATE,
  noteStyle = false,
) {
  const buffer = await thesisToDocx({
    spec: SPEC,
    details: readThesisDetails({}),
    documentTitle: 'A thesis',
    chapters: [{ id: 'c1', title: 'Results', order: 1, content: CONTENT, renderedMap }],
    bibliography: BIBLIOGRAPHY,
    noteStyle,
    ...(mode ? { citationLinks: { mode, entrySources: ENTRY_SOURCES, sources: SOURCES } } : {}),
  });
  return open(buffer);
}

async function open(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const read = async (path: string) => (await zip.file(path)?.async('string')) ?? '';
  return {
    zip,
    document: await read('word/document.xml'),
    footnotes: await read('word/footnotes.xml'),
    rels: await read('word/_rels/document.xml.rels'),
    types: await read('[Content_Types].xml'),
    sources: await read('customXml/item1.xml'),
    itemProps: await read('customXml/itemProps1.xml'),
    itemRels: await read('customXml/_rels/item1.xml.rels'),
  };
}

const decodeXml = (text: string) =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/** What a reader sees: every `w:t`, with field instructions (never displayed) left out. */
const visibleText = (xml: string) =>
  decodeXml(
    [
      ...xml
        .replace(/<w:instrText\b[^>]*>.*?<\/w:instrText>/g, '')
        .matchAll(/<w:t\b[^>]*>(.*?)<\/w:t>/g),
    ]
      .map((m) => m[1])
      .join(''),
  );

const hyperlinks = (xml: string) =>
  [...xml.matchAll(/<w:hyperlink\b[^>]*w:anchor="([^"]+)"[^>]*>(.*?)<\/w:hyperlink>/g)].map(
    (m) => ({ anchor: m[1], text: visibleText(m[2] ?? '') }),
  );

/** Bookmark name → the text it wraps. */
const bookmarks = (xml: string) =>
  Object.fromEntries(
    [
      ...xml.matchAll(
        /<w:bookmarkStart\b[^>]*w:name="([^"]+)"[^>]*w:id="(\d+)"\/>(.*?)<w:bookmarkEnd w:id="\2"\/>/g,
      ),
    ].map((m) => [m[1], visibleText(m[3] ?? '')]),
  );

describe('plain citations (the default)', () => {
  it('are unchanged: text only, no links, fields, bookmarks or source list', async () => {
    for (const file of [await thesis(undefined), await thesis('plain')]) {
      expect(file.document).not.toContain('<w:hyperlink');
      expect(file.document).not.toContain('<w:fldSimple');
      expect(file.document).not.toContain('bookmarkStart');
      expect(file.document).not.toContain('BIBLIOGRAPHY');
      expect(file.zip.file('customXml/item1.xml')).toBeNull();
      expect(visibleText(file.document)).toContain(
        'Yields rose (Kumar & Rao, 2021, p. 52) while water use fell',
      );
    }
  });
});

describe('linked citations', () => {
  it('link each citation to a bookmark on its own bibliography entry', async () => {
    const { document } = await thesis('linked');
    const links = hyperlinks(document);
    const marks = bookmarks(document);
    expect(links).toEqual([
      { anchor: 'tc_ref_1', text: AUTHOR_DATE.n1 },
      { anchor: 'tc_ref_2', text: AUTHOR_DATE.n2 },
    ]);
    expect(marks).toEqual({ tc_ref_1: BIBLIOGRAPHY[0], tc_ref_2: BIBLIOGRAPHY[1] });
  });

  it('leave a citation whose paper is not in the bibliography as plain text', async () => {
    const { document } = await thesis('linked');
    expect(visibleText(document)).toContain(`cites a deleted paper ${AUTHOR_DATE.n3}.`);
    expect(hyperlinks(document).map((l) => l.text)).not.toContain(AUTHOR_DATE.n3);
  });

  it('give every bookmark its own id (docx numbers them all 1)', async () => {
    const { document } = await thesis('linked');
    const ids = [...document.matchAll(/<w:bookmarkStart\b[^>]*w:id="(\d+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('read exactly as the plain file does, in author-date and numeric styles', async () => {
    for (const map of [AUTHOR_DATE, NUMERIC]) {
      const plain = await thesis('plain', map);
      const linked = await thesis('linked', map);
      expect(visibleText(linked.document)).toBe(visibleText(plain.document));
    }
    const numeric = await thesis('linked', NUMERIC);
    expect(hyperlinks(numeric.document)).toEqual([
      { anchor: 'tc_ref_1', text: '[1, p. 52]' },
      { anchor: 'tc_ref_2', text: '[2]' },
    ]);
  });

  it('in a note style, link the footnote’s note to the entry and keep the footnotes', async () => {
    const plain = await thesis('plain', NOTES, true);
    const linked = await thesis('linked', NOTES, true);
    expect(linked.document.match(/<w:footnoteReference w:id="\d+"\/>/g)).toHaveLength(3);
    expect(hyperlinks(linked.footnotes)).toEqual([
      { anchor: 'tc_ref_1', text: NOTES.n1 },
      { anchor: 'tc_ref_2', text: NOTES.n2 },
    ]);
    expect(bookmarks(linked.document)).toEqual({
      tc_ref_1: BIBLIOGRAPHY[0],
      tc_ref_2: BIBLIOGRAPHY[1],
    });
    expect(visibleText(linked.footnotes)).toBe(visibleText(plain.footnotes));
    expect(visibleText(linked.document)).toBe(visibleText(plain.document));
  });
});

describe('Word citation fields', () => {
  it('write each citation as a CITATION field whose result is our rendered label', async () => {
    const { document, sources } = await thesis('word');
    const fields = [...document.matchAll(/<w:fldSimple w:instr="([^"]*)">(.*?)<\/w:fldSimple>/g)];
    expect(fields.map((m) => decodeXml(m[1] ?? ''))).toEqual([
      ' CITATION Kumar2021Soil \\p "52" ',
      ' CITATION Organization2019Irrigation ',
    ]);
    expect(fields.map((m) => visibleText(m[2] ?? ''))).toEqual([AUTHOR_DATE.n1, AUTHOR_DATE.n2]);
    // Every tag a field names is a source in Word's list.
    for (const tag of ['Kumar2021Soil', 'Organization2019Irrigation']) {
      expect(sources).toContain(`<b:Tag>${tag}</b:Tag>`);
    }
  });

  it('wrap the bibliography in one BIBLIOGRAPHY field with our entries as its result', async () => {
    const { document } = await thesis('word');
    // The contents pages are complex fields too; this one is the field that names BIBLIOGRAPHY.
    const instr = document.indexOf(
      '<w:instrText xml:space="preserve"> BIBLIOGRAPHY </w:instrText>',
    );
    const begin = document.lastIndexOf('<w:fldChar w:fldCharType="begin"/>', instr);
    const separate = document.indexOf('<w:fldChar w:fldCharType="separate"/>', instr);
    const end = document.indexOf('<w:fldChar w:fldCharType="end"/>', instr);
    const first = document.indexOf('Kumar, A., &amp; Rao');
    const last = document.indexOf('Irrigation report. WHO.');
    expect(begin).toBeGreaterThan(0);
    expect([begin, instr, separate, first, last, end]).toEqual(
      [begin, instr, separate, first, last, end].sort((a, b) => a - b),
    );
    // Directly after begin, and the entries sit between separate and end.
    expect(instr - begin).toBe('<w:fldChar w:fldCharType="begin"/></w:r><w:r>'.length);
    expect(document.match(/ BIBLIOGRAPHY /g)).toHaveLength(1);
    // No marker left behind as visible text.
    expect(document).not.toContain('TC-BIBLIOGRAPHY');
    // The References heading is outside the field, where Word's own refresh leaves it.
    expect(document.indexOf(SPEC.bibliography.title)).toBeLessThan(begin);
  });

  it('read exactly as the plain file does', async () => {
    for (const map of [AUTHOR_DATE, NUMERIC]) {
      const plain = await thesis('plain', map);
      const word = await thesis('word', map);
      expect(visibleText(word.document)).toBe(visibleText(plain.document));
    }
  });

  it('leave a citation whose paper has no source entry as plain text', async () => {
    const { document } = await thesis('word');
    expect(document).not.toContain('CITATION Gone');
    expect(visibleText(document)).toContain(`cites a deleted paper ${AUTHOR_DATE.n3}.`);
  });

  it('store the sources as a customXml part Word reads as its source list', async () => {
    const file = await thesis('word');
    expect(file.sources).toContain(
      '<b:Sources xmlns:b="http://schemas.openxmlformats.org/officeDocument/2006/bibliography"',
    );
    expect(file.itemProps).toMatch(/<ds:datastoreItem ds:itemID="\{[0-9A-F-]{36}\}"/);
    expect(file.itemProps).toContain(
      'ds:uri="http://schemas.openxmlformats.org/officeDocument/2006/bibliography"',
    );
    expect(file.itemRels).toContain('Target="itemProps1.xml"');
    expect(file.rels).toContain(
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/item1.xml"',
    );
    expect(file.types).toContain('PartName="/customXml/itemProps1.xml"');
  });

  it('fall back to linked citations in a note style, which Word cannot own', async () => {
    const file = await thesis('word', NOTES, true);
    expect(file.document).not.toContain('<w:fldSimple');
    expect(file.document).not.toContain('BIBLIOGRAPHY');
    expect(file.zip.file('customXml/item1.xml')).toBeNull();
    expect(hyperlinks(file.footnotes).map((l) => l.anchor)).toEqual(['tc_ref_1', 'tc_ref_2']);
    expect(file.document.match(/<w:footnoteReference w:id="\d+"\/>/g)).toHaveLength(3);
  });
});

describe('the chapter export', () => {
  const options = (mode: CitationMode) => ({
    title: 'Results',
    renderedMap: AUTHOR_DATE,
    bibliography: BIBLIOGRAPHY,
    citationLinks: { mode, entrySources: ENTRY_SOURCES, sources: SOURCES },
  });

  it('links and fields its citations the same way', async () => {
    const plain = await open(await chapterToDocx(CONTENT, options('plain')));
    const linked = await open(await chapterToDocx(CONTENT, options('linked')));
    const word = await open(await chapterToDocx(CONTENT, options('word')));
    expect(hyperlinks(linked.document).map((l) => l.anchor)).toEqual(['tc_ref_1', 'tc_ref_2']);
    expect(Object.keys(bookmarks(linked.document))).toEqual(['tc_ref_1', 'tc_ref_2']);
    expect(word.document.match(/<w:fldSimple w:instr=" CITATION /g)).toHaveLength(2);
    expect(word.document).toContain(' BIBLIOGRAPHY ');
    expect(visibleText(linked.document)).toBe(visibleText(plain.document));
    expect(visibleText(word.document)).toBe(visibleText(plain.document));
  });
});

describe('Word’s source list', () => {
  it('maps CSL to the bibliography schema, escaping text', () => {
    const xml = wordSource(SOURCES[0] as (typeof SOURCES)[number], 'Kumar2021Soil');
    expect(xml).toContain('<b:SourceType>JournalArticle</b:SourceType>');
    expect(xml).toContain(
      '<b:Author><b:Author><b:NameList><b:Person><b:Last>Kumar</b:Last><b:First>Anil</b:First></b:Person>',
    );
    expect(xml).toContain('<b:Title>Soil carbon &amp; yield</b:Title>');
    expect(xml).toContain('<b:JournalName>Journal of Agronomy</b:JournalName>');
    expect(xml).toContain('<b:Pages>45-67</b:Pages>');
    expect(xml).toContain('<b:DOI>10.1000/agro.2021.12</b:DOI>');
  });

  it('writes an organisation as Word’s corporate author', () => {
    const xml = wordSource(SOURCES[1] as (typeof SOURCES)[number], 'WHO2019');
    expect(xml).toContain(
      '<b:Author><b:Author><b:Corporate>World Health Organization</b:Corporate></b:Author></b:Author>',
    );
    expect(xml).toContain('<b:SourceType>Report</b:SourceType>');
  });

  it('only lists sources that have a tag', () => {
    const xml = wordSourcesXml(SOURCES, new Map([['s-who', 'WHO2019']]));
    expect(xml.match(/<b:Source>/g)).toHaveLength(1);
  });
});

describe('the finishing pass', () => {
  it('pairs bookmark ids by order', () => {
    const xml =
      '<w:bookmarkStart w:name="a" w:id="1"/>x<w:bookmarkEnd w:id="1"/>' +
      '<w:bookmarkStart w:name="b" w:id="1"/>y<w:bookmarkEnd w:id="1"/>';
    expect(renumberBookmarks(xml)).toBe(
      '<w:bookmarkStart w:name="a" w:id="1"/>x<w:bookmarkEnd w:id="1"/>' +
        '<w:bookmarkStart w:name="b" w:id="2"/>y<w:bookmarkEnd w:id="2"/>',
    );
  });

  it('refuses to ship a bibliography whose field markers went missing', () => {
    expect(() => bibliographyField('<w:p/>')).toThrow(/markers/);
  });
});
