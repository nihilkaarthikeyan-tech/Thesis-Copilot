/**
 * Citations that stay connected in the exported `.docx` — ADR-0055.
 *
 * Until ADR-0055 every in-text citation was a run of text. Word could not restyle it, and nothing
 * led from "(Kumar et al., 2021)" to Kumar's entry in the references. Two modes now exist beside
 * that plain one, and this file is everything the two Word exporters (`thesis.ts`, `docx.ts`)
 * share about them:
 *
 *   - **`linked`** — the citation is an internal hyperlink to a bookmark on its bibliography entry.
 *     The text is unchanged and unstyled, so the page looks exactly as it did; the link survives
 *     Word (any platform), LibreOffice and Google Docs. Nothing restyles.
 *   - **`word`** — Word's own citations: the sources go into the document's source list (a
 *     `customXml` part in the bibliography schema), each citation is a `CITATION` field and the
 *     bibliography a `BIBLIOGRAPHY` field. Every field carries our rendered text as its result, so
 *     the file reads correctly before anything is refreshed, and no field is marked dirty — Word
 *     re-renders only when the student picks a style or updates the fields.
 *
 * A note style (ADR-0029) has no in-text label for Word to own: Word's citation engine cannot write
 * footnote citations, and refreshing a field inside a footnote would turn "J. Smith, *Title*
 * (Delhi: Sage, 2020), 12." into "(Smith, 2020)". `word` therefore falls back to `linked` there —
 * the footnote's note links to its entry.
 *
 * Two pieces go past the `docx` package's public API, and both are done after `Packer` on the
 * finished zip rather than by faking the package's classes (the lesson of `fieldParagraph`):
 *   - a field that spans paragraphs (the bibliography) — `docx` only has the one-paragraph
 *     `SimpleField`, so the entries are written between two marker runs that are then replaced by
 *     the `fldChar` begin/separate and end runs;
 *   - the `customXml` source list, which `docx` has no notion of.
 * And one corrects the package: `Bookmark` numbers every bookmark `w:id="1"` (a fresh counter per
 * instance in docx 9.7.1), so the ids are renumbered to be unique.
 */

import { randomUUID } from 'node:crypto';
import {
  type CslItem,
  type CslName,
  citationKeys,
  type SourceLike,
  toCslItem,
} from '@tc/citations';
import type { CitationMode } from '@tc/types';
import { Bookmark, InternalHyperlink, type ParagraphChild, SimpleField, TextRun } from 'docx';
import JSZip from 'jszip';

/** What an exporter is told about citations beyond their labels. */
export type CitationLinksInput = {
  mode: CitationMode;
  /** The source of each bibliography entry, index for index with the bibliography. */
  entrySources: readonly string[];
  /** `word` only: the cited sources, for Word's source list. Missing ones stay as plain text. */
  sources?: readonly SourceLike[];
};

/** The per-export state both exporters read while building the body. */
export type CitationLinks = {
  /** The mode actually written: `word` becomes `linked` in a note style. */
  mode: CitationMode;
  /** Source id → bookmark name on its bibliography entry (`linked`). */
  anchors: ReadonlyMap<string, string>;
  /** Source id → Word source tag (`word`). */
  tags: ReadonlyMap<string, string>;
  /** `word` only: the `b:Sources` part. */
  sourcesXml?: string;
};

export const PLAIN_CITATIONS: CitationLinks = {
  mode: 'plain',
  anchors: new Map(),
  tags: new Map(),
};

/** Word bookmark names: a letter first, then letters, digits and underscores, at most 40. */
export const bookmarkName = (index: number): string => `tc_ref_${index + 1}`;

/** Marker runs around the bibliography, replaced by the field's `fldChar` runs after packing. */
const BIB_BEGIN = 'TC-BIBLIOGRAPHY-FIELD-BEGIN';
const BIB_END = 'TC-BIBLIOGRAPHY-FIELD-END';

export function resolveCitationLinks(
  input: CitationLinksInput | undefined,
  noteStyle: boolean,
): CitationLinks {
  if (!input || input.mode === 'plain') return PLAIN_CITATIONS;
  const mode: CitationMode = input.mode === 'word' && noteStyle ? 'linked' : input.mode;

  if (mode === 'linked') {
    const anchors = new Map<string, string>();
    input.entrySources.forEach((sourceId, index) => {
      if (sourceId && !anchors.has(sourceId)) anchors.set(sourceId, bookmarkName(index));
    });
    return { mode, anchors, tags: new Map() };
  }

  // `word`: only sources that are both cited (in the bibliography) and described get a tag.
  const inBibliography = new Set(input.entrySources);
  const sources = (input.sources ?? []).filter((source) => inBibliography.has(source.id));
  const tags = citationKeys(sources);
  return { mode, anchors: new Map(), tags, sourcesXml: wordSourcesXml(sources, tags) };
}

const resolved = new WeakMap<object, CitationLinks>();

/** The links for one export, resolved once and keyed on its input object (as `notesFor` is). */
export function citationLinksFor(owner: {
  citationLinks?: CitationLinksInput;
  noteStyle?: boolean;
}): CitationLinks {
  let links = resolved.get(owner);
  if (!links) {
    links = resolveCitationLinks(owner.citationLinks, owner.noteStyle === true);
    resolved.set(owner, links);
  }
  return links;
}

type CitationNode = { attrs?: Record<string, unknown> };

const attr = (node: CitationNode, name: string): string => {
  const value = node.attrs?.[name];
  return typeof value === 'string' ? value.trim() : '';
};

/** A field argument: Word's field grammar quotes with `"` and has no escape we can rely on. */
const fieldArg = (text: string): string => `"${text.replace(/"/g, "'")}"`;

/**
 * Word's `CITATION` field instruction for one citation node, or null when its source has no tag.
 * The page/locator, prefix and suffix go in as switches so Word keeps them when it re-renders.
 */
export function citationInstruction(node: CitationNode, links: CitationLinks): string | null {
  const tag = links.tags.get(attr(node, 'sourceId'));
  if (!tag) return null;
  const switches = [
    attr(node, 'locator') && `\\p ${fieldArg(attr(node, 'locator'))}`,
    attr(node, 'prefix') && `\\f ${fieldArg(attr(node, 'prefix'))}`,
    attr(node, 'suffix') && `\\s ${fieldArg(attr(node, 'suffix'))}`,
  ].filter(Boolean);
  return ` ${['CITATION', tag, ...switches].join(' ')} `;
}

/**
 * An in-text citation in the chosen mode. `run` builds the visible text run the exporter would
 * have written anyway, so the label, font and size are identical in all three modes.
 */
export function citationChild(
  node: CitationNode,
  label: string,
  links: CitationLinks,
  run: (text: string) => TextRun,
): ParagraphChild {
  if (links.mode === 'word') {
    const instruction = citationInstruction(node, links);
    // `SimpleField`'s result run takes the document's default font, which both exporters set.
    if (instruction) return new SimpleField(instruction, label);
  }
  const anchor = links.anchors.get(attr(node, 'sourceId'));
  if (links.mode === 'linked' && anchor) {
    return new InternalHyperlink({ anchor, children: [run(label)] });
  }
  return run(label);
}

/** A note-style citation's note, linked to its entry when the mode links. */
export function noteChildren(
  node: CitationNode,
  note: string,
  links: CitationLinks,
  run: (text: string) => TextRun,
): ParagraphChild[] {
  const anchor = links.anchors.get(attr(node, 'sourceId'));
  return links.mode === 'linked' && anchor
    ? [new InternalHyperlink({ anchor, children: [run(note)] })]
    : [run(note)];
}

/** The children of bibliography entry `index` of `count`, in the chosen mode. */
export function bibliographyEntryChildren(
  index: number,
  count: number,
  entry: TextRun,
  links: CitationLinks,
): ParagraphChild[] {
  if (links.mode === 'linked') {
    return [new Bookmark({ id: bookmarkName(index), children: [entry] })];
  }
  if (links.mode === 'word' && links.tags.size > 0) {
    return [
      ...(index === 0 ? [new TextRun(BIB_BEGIN)] : []),
      entry,
      ...(index === count - 1 ? [new TextRun(BIB_END)] : []),
    ];
  }
  return [entry];
}

// ---------------------------------------------------------------------------------------------
// After packing
// ---------------------------------------------------------------------------------------------

const BIBLIOGRAPHY_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/bibliography';
const CUSTOM_XML_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml';
const CUSTOM_XML_PROPS_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps';
const CUSTOM_XML_PROPS_TYPE =
  'application/vnd.openxmlformats-officedocument.customXmlProperties+xml';

/** The marker run exactly as `docx` writes a `new TextRun(text)`. */
const markerRun = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;

const FIELD_BEGIN =
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  '<w:r><w:instrText xml:space="preserve"> BIBLIOGRAPHY </w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>';
const FIELD_END = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';

/**
 * Gives every bookmark its own id. `docx` numbers each `Bookmark` from a fresh counter, so all of
 * them are `w:id="1"`; Word pairs a start with its end by id. Ours never nest, and the pairing
 * below is by order (a stack), so any other bookmark keeps its own start/end pairing too.
 */
export function renumberBookmarks(xml: string): string {
  let next = 0;
  const open: string[] = [];
  return xml.replace(
    /<w:bookmark(Start|End)\b([^>]*?)\/>/g,
    (whole, kind: string, rest: string) => {
      if (kind === 'Start') {
        next += 1;
        const id = String(next);
        open.push(id);
        return `<w:bookmarkStart${rest.replace(/w:id="[^"]*"/, `w:id="${id}"`)}/>`;
      }
      const id = open.pop();
      return id ? `<w:bookmarkEnd${rest.replace(/w:id="[^"]*"/, `w:id="${id}"`)}/>` : whole;
    },
  );
}

/** Turns the two marker runs into the `BIBLIOGRAPHY` field's begin/separate and end. */
export function bibliographyField(xml: string): string {
  const begin = markerRun(BIB_BEGIN);
  const end = markerRun(BIB_END);
  if (!xml.includes(begin) || !xml.includes(end)) {
    // Never ship a marker as visible text.
    throw new Error('Bibliography field markers were not written as expected');
  }
  return xml.replace(begin, FIELD_BEGIN).replace(end, FIELD_END);
}

/**
 * The finishing pass on a packed `.docx`. A no-op for `plain`, so the default file is byte for
 * byte what it was before ADR-0055.
 */
export async function finishCitationLinks(docx: Buffer, links: CitationLinks): Promise<Buffer> {
  if (links.mode === 'plain') return docx;
  const zip = await JSZip.loadAsync(docx);
  const documentPath = 'word/document.xml';
  let document = (await zip.file(documentPath)?.async('string')) ?? '';
  document = renumberBookmarks(document);
  if (links.mode === 'word' && links.sourcesXml) {
    if (document.includes(markerRun(BIB_BEGIN))) document = bibliographyField(document);
    await addSourcesPart(zip, links.sourcesXml);
  }
  zip.file(documentPath, document);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Word's source list: `customXml/item1.xml`, its properties part, and the relationships. */
async function addSourcesPart(zip: JSZip, sourcesXml: string): Promise<void> {
  const itemId = `{${randomUUID().toUpperCase()}}`;
  zip.file('customXml/item1.xml', sourcesXml);
  zip.file(
    'customXml/itemProps1.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>' +
      `<ds:datastoreItem ds:itemID="${itemId}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml">` +
      `<ds:schemaRefs><ds:schemaRef ds:uri="${BIBLIOGRAPHY_NS}"/></ds:schemaRefs></ds:datastoreItem>`,
  );
  zip.file(
    'customXml/_rels/item1.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `<Relationship Id="rId1" Type="${CUSTOM_XML_PROPS_REL}" Target="itemProps1.xml"/>` +
      '</Relationships>',
  );

  const relsPath = 'word/_rels/document.xml.rels';
  const rels = (await zip.file(relsPath)?.async('string')) ?? '';
  zip.file(
    relsPath,
    rels.replace(
      '</Relationships>',
      `<Relationship Id="rIdTcSources" Type="${CUSTOM_XML_REL}" Target="../customXml/item1.xml"/></Relationships>`,
    ),
  );

  const typesPath = '[Content_Types].xml';
  let types = (await zip.file(typesPath)?.async('string')) ?? '';
  if (!types.includes('Extension="xml"')) {
    types = types.replace(
      '</Types>',
      '<Default ContentType="application/xml" Extension="xml"/></Types>',
    );
  }
  zip.file(
    typesPath,
    types.replace(
      '</Types>',
      `<Override ContentType="${CUSTOM_XML_PROPS_TYPE}" PartName="/customXml/itemProps1.xml"/></Types>`,
    ),
  );
}

// ---------------------------------------------------------------------------------------------
// The source list, CSL → Word's bibliography schema
// ---------------------------------------------------------------------------------------------

const XML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};
const xmlText = (text: string): string => text.replace(/[&<>"']/g, (c) => XML_ENTITIES[c] ?? c);

/** CSL item types → Word's `b:SourceType`. Anything else is `Misc`, which Word prints sensibly. */
const SOURCE_TYPES: Record<string, string> = {
  'article-journal': 'JournalArticle',
  'article-magazine': 'ArticleInAPeriodical',
  'article-newspaper': 'ArticleInAPeriodical',
  book: 'Book',
  chapter: 'BookSection',
  'paper-conference': 'ConferenceProceedings',
  report: 'Report',
  thesis: 'Report',
  webpage: 'InternetSite',
  'post-weblog': 'InternetSite',
  patent: 'Patent',
  legal_case: 'Case',
};

/** Where the container title goes for each Word source type. */
const CONTAINER_ELEMENT: Record<string, string> = {
  JournalArticle: 'JournalName',
  ArticleInAPeriodical: 'PeriodicalTitle',
  BookSection: 'BookTitle',
  ConferenceProceedings: 'ConferenceName',
  InternetSite: 'InternetSiteTitle',
};

const firstString = (value: unknown): string => {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' || typeof first === 'number' ? String(first).trim() : '';
};

function nameList(names: readonly CslName[]): string {
  const people = names
    .map((name) => {
      const last = (name.family ?? name.literal ?? '').trim();
      const first = (name.given ?? '').trim();
      if (!last && !first) return '';
      return `<b:Person><b:Last>${xmlText(last || first)}</b:Last>${last && first ? `<b:First>${xmlText(first)}</b:First>` : ''}</b:Person>`;
    })
    .join('');
  return people ? `<b:NameList>${people}</b:NameList>` : '';
}

function contributors(item: CslItem): string {
  const authors = (item.author ?? []) as CslName[];
  const editors = (Array.isArray(item.editor) ? item.editor : []) as CslName[];
  // A body as the only author ("World Health Organization") is Word's `Corporate`, not a person.
  const corporate =
    authors.length === 1 && authors[0]?.literal && !authors[0].family
      ? `<b:Author><b:Corporate>${xmlText(authors[0].literal)}</b:Corporate></b:Author>`
      : '';
  const authorList =
    corporate || (nameList(authors) && `<b:Author>${nameList(authors)}</b:Author>`);
  const editorList = nameList(editors) && `<b:Editor>${nameList(editors)}</b:Editor>`;
  return authorList || editorList ? `<b:Author>${authorList}${editorList}</b:Author>` : '';
}

/** One source in Word's bibliography schema. */
export function wordSource(source: SourceLike, tag: string): string {
  const item = toCslItem(source);
  const type = SOURCE_TYPES[item.type] ?? 'Misc';
  const year = item.issued?.['date-parts']?.[0]?.[0];
  const container = firstString(item['container-title']);
  const fields: Array<[string, string]> = [
    ['Title', firstString(item.title)],
    ['Year', year ? String(year) : ''],
    [CONTAINER_ELEMENT[type] ?? 'BookTitle', type in CONTAINER_ELEMENT ? container : ''],
    ['Publisher', firstString(item.publisher)],
    ['City', firstString(item['publisher-place'])],
    ['Volume', firstString(item.volume)],
    ['Issue', firstString(item.issue)],
    ['Pages', firstString(item.page)],
    ['DOI', firstString(item.DOI)],
    ['URL', firstString(item.URL)],
  ];
  return (
    `<b:Source><b:Tag>${xmlText(tag)}</b:Tag><b:SourceType>${type}</b:SourceType>` +
    contributors(item) +
    fields
      .filter(([, value]) => value)
      .map(([name, value]) => `<b:${name}>${xmlText(value)}</b:${name}>`)
      .join('') +
    '</b:Source>'
  );
}

/**
 * The whole `b:Sources` part. No `SelectedStyle`: Word keeps whichever style the student last
 * chose, and our pre-rendered text stands until they choose one here.
 */
export function wordSourcesXml(
  sources: readonly SourceLike[],
  tags: ReadonlyMap<string, string>,
): string {
  const body = sources
    .map((source) => {
      const tag = tags.get(source.id);
      return tag ? wordSource(source, tag) : '';
    })
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>' +
    `<b:Sources xmlns:b="${BIBLIOGRAPHY_NS}" xmlns="${BIBLIOGRAPHY_NS}">${body}</b:Sources>`
  );
}
