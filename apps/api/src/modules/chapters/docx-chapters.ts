/**
 * A Word file's HTML (mammoth's) as thesis chapters in the editor's ProseMirror JSON (2026-10-04,
 * "Import from Word", from the Jenni study).
 *
 * Pure: HTML in, chapters out, so the rules are testable without a file, a request or a database.
 * The service checks every document this returns against the editor's own schema before saving.
 *
 * What comes across, and what does not:
 *   - Heading 1 starts a chapter and becomes its title. With no Heading 1, the whole file is one
 *     chapter. Text before the first Heading 1 (a title page, an abstract) is its own chapter,
 *     marked so the preview can say where it came from.
 *   - Heading 2 and 3 stay headings (4–6 become 3: the editor has three levels, B.2).
 *   - Paragraphs, bold, italic, underline, strike, superscript, subscript, links, line breaks,
 *     bulleted and numbered lists, block quotes and tables (merged cells kept).
 *   - Footnotes become the editor's own footnote nodes (ADR-0029's plain-text notes).
 *   - Pictures do not: the caller counts them, and the student inserts each as a figure.
 *   - Citations typed as text — "(Kumar, 2021)", "[3]" — stay text. They are counted so the
 *     student knows how many to link; nothing here guesses which source one means.
 *   - A references section ("References", "Bibliography", …) comes across as text too. It is
 *     found and reported, so the dialog can say why the citations were not linked (R34,
 *     ADR-0113), and its entries are left out of the citation count: an IEEE list's "[1]" is an
 *     entry, not a citation.
 */

import { FOOTNOTE_MAX } from '@tc/ui';
import { type DefaultTreeAdapterMap, parseFragment } from 'parse5';
import { totalWords, wordCountsOf } from './word-counts.js';

type Element = DefaultTreeAdapterMap['element'];
type ChildNode = DefaultTreeAdapterMap['childNode'];

export type PmMark = { type: string; attrs?: Record<string, unknown> };
export type PmNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PmNode[];
  text?: string;
  marks?: PmMark[];
};

export type ImportedChapter = {
  title: string;
  /** The chapter's blocks after its title. */
  blocks: PmNode[];
  /** Heading 2 titles, in order — they become the outline node's sections. */
  sections: string[];
  /**
   * Words in the body (the title is not counted): only for "is this chapter empty". The count a
   * student is shown is `chapterWords`, the chapter rail's.
   */
  words: number;
  /** Text that came before the first Heading 1. */
  preamble: boolean;
};

export type DocxChapters = {
  chapters: ImportedChapter[];
  /** False when the file had no Heading 1 and became one chapter. */
  splitAtHeadings: boolean;
  footnotes: number;
  tables: number;
  /**
   * Text that looks like a citation typed by hand — "(Kumar, 2021)", "Kumar (2021)", "[3]" —
   * outside any references section.
   */
  citationLike: number;
  /** Every references section found, in order (ADR-0113). */
  references: ReferencesSection[];
};

/** A references section: its heading as written, the chapter it came in as, its entries. */
export type ReferencesSection = { heading: string; chapter: string; entries: number };

/** A references heading is a short line; anything longer is a sentence that mentions them. */
const REFERENCES_HEADING_MAX = 60;

/**
 * The names a references section goes by, after an optional number ("7.", "Chapter 7:", "VII."),
 * in any case, with an optional colon. The whole line must be the name: "References to the old
 * scheme" is a sentence.
 */
const REFERENCES_HEADING =
  /^(?:(?:chapter|section|part)\s+)?(?:(?:\d+(?:\.\d+)*|[ivxlc]+)[\s.):–-]+)?(?:references?(?:\s+cited)?|reference\s+list|list\s+of\s+references|(?:select(?:ed)?\s+)?bibliography|works\s+cited|literature\s+cited|sources\s+cited|cited\s+(?:works|literature))\s*:?$/iu;

export function isReferencesHeading(text: string): boolean {
  const line = collapse(text);
  return line.length <= REFERENCES_HEADING_MAX && REFERENCES_HEADING.test(line);
}

/** A chapter title is a heading, not a paragraph; anything longer is cut. */
export const TITLE_MAX = 200;

const MARK_TAGS: Record<string, string> = {
  strong: 'bold',
  b: 'bold',
  em: 'italic',
  i: 'italic',
  u: 'underline',
  s: 'strike',
  del: 'strike',
  strike: 'strike',
  sup: 'superscript',
  sub: 'subscript',
};

const BLOCK_TAGS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'table',
  'blockquote',
  'pre',
  'div',
  'li',
]);

function isElement(node: ChildNode): node is Element {
  return 'tagName' in node;
}

function attr(el: Element, name: string): string | null {
  return el.attrs.find((a) => a.name === name)?.value ?? null;
}

/** The text of an element, whitespace collapsed. */
function textOf(node: ChildNode | Element): string {
  if (node.nodeName === '#text') return (node as { value: string }).value;
  if (!isElement(node as ChildNode)) return '';
  return (node as Element).childNodes.map(textOf).join('');
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function wordsIn(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** All the text in a list of nodes, one space between blocks. */
function plainText(nodes: readonly PmNode[]): string {
  const parts: string[] = [];
  const walk = (node: PmNode) => {
    if (node.type === 'text' && node.text) parts.push(node.text);
    for (const child of node.content ?? []) walk(child);
    if (node.type !== 'text') parts.push(' ');
  };
  for (const node of nodes) walk(node);
  return parts.join('');
}

/** `#footnote-3`, `#endnote-1`: mammoth's link from a reference to its note. */
const NOTE_HREF = /^#(footnote|endnote)-(.+)$/;
const NOTE_ID = /^(footnote|endnote)-(.+)$/;

/**
 * Counts the citations a student typed as text — one per paper cited, which is what the student
 * will have to link (QA 2026-10-08: "(Rao & Singh, 2019; Patel et al., 2020)" is two, not one).
 * Three shapes:
 *   - a parenthesis holding a capitalised name and a year: "(Kumar, 2021)" is one, "(Rao & Iyer
 *     2019; Sen et al., 2020a)" two — each ';'-separated name-and-year is its own citation
 *   - a name followed by a bracketed year: "Kumar (2021)" is one
 *   - a bracketed number list, one per number: "[3]" is one, "[1], [2]" two, "[1-3]" three,
 *     "[1, 4–6]" four. A range that runs backwards or past 99 numbers is a typo, counted once.
 */
export function countCitationLike(text: string): number {
  const year = /\b(?:1[89]|20)\d{2}[a-z]?\b/u;
  const name = /\p{Lu}\p{L}+/u;
  const parenthetical = /\(([^()]*\b(?:1[89]|20)\d{2}[a-z]?\b[^()]*)\)/gu;
  const narrative = /\p{Lu}[\p{L}'’-]+(?:\s+et\s+al\.?)?\s+\((?:1[89]|20)\d{2}[a-z]?\)/gu;
  const numeric = /\[(\d+(?:\s*[-–,]\s*\d+)*)\]/g;
  let count = 0;
  for (const match of text.matchAll(parenthetical)) {
    const inner = match[1] ?? '';
    if (!name.test(inner)) continue;
    const parts = inner.split(';').filter((part) => name.test(part) && year.test(part)).length;
    count += Math.max(1, parts);
  }
  count += [...text.matchAll(narrative)].length;
  for (const match of text.matchAll(numeric)) {
    for (const item of (match[1] ?? '').split(',')) {
      const [from, to] = item.split(/[-–]/).map((n) => Number.parseInt(n.trim(), 10));
      const span = to === undefined || from === undefined ? 1 : to - from + 1;
      count += span >= 1 && span <= 100 ? span : 1;
    }
  }
  return count;
}

class Converter {
  readonly notes = new Map<string, string>();
  footnotes = 0;
  tables = 0;

  /** Inline content of `nodes`, with `marks` applied. */
  inline(nodes: readonly ChildNode[], marks: readonly PmMark[]): PmNode[] {
    const out: PmNode[] = [];
    for (const node of nodes) {
      if (node.nodeName === '#text') {
        // Line breaks in the source HTML are not line breaks in the document.
        const text = (node as { value: string }).value.replace(/[\r\n\t]+/g, ' ');
        if (text.length > 0) {
          out.push(
            marks.length > 0 ? { type: 'text', text, marks: [...marks] } : { type: 'text', text },
          );
        }
        continue;
      }
      if (!isElement(node)) continue;
      const tag = node.tagName;
      if (tag === 'br') {
        out.push({ type: 'hardBreak' });
        continue;
      }
      if (tag === 'img') continue;
      if (tag === 'sup' || tag === 'a') {
        const note = this.noteReference(node);
        if (note !== undefined) {
          if (note) {
            out.push({ type: 'footnote', attrs: { text: note } });
            this.footnotes++;
          }
          continue;
        }
      }
      if (tag === 'a') {
        const href = attr(node, 'href') ?? '';
        const link = /^(https?:|mailto:)/i.test(href) && !marks.some((m) => m.type === 'link');
        out.push(
          ...this.inline(
            node.childNodes,
            link ? [...marks, { type: 'link', attrs: { href } }] : marks,
          ),
        );
        continue;
      }
      const mark = MARK_TAGS[tag];
      if (mark && !marks.some((m) => m.type === mark)) {
        out.push(...this.inline(node.childNodes, [...marks, { type: mark }]));
        continue;
      }
      // A span, a bookmark, or a block tag where only inline content fits: its children.
      out.push(...this.inline(node.childNodes, marks));
    }
    return out;
  }

  /**
   * The note a `<sup><a href="#footnote-1">` points at: its text, `''` for a reference to a note
   * that is not in the file (dropped), or `undefined` when the element is not a note reference.
   */
  private noteReference(el: Element): string | undefined {
    const anchor =
      el.tagName === 'a'
        ? el
        : el.childNodes.find((c): c is Element => isElement(c) && c.tagName === 'a');
    if (!anchor) return undefined;
    const match = NOTE_HREF.exec(attr(anchor, 'href') ?? '');
    if (!match) return undefined;
    return this.notes.get(`${match[1]}-${match[2]}`) ?? '';
  }

  /** Block content of `nodes`. Loose inline content is gathered into paragraphs. */
  blocks(nodes: readonly ChildNode[]): PmNode[] {
    const out: PmNode[] = [];
    let loose: ChildNode[] = [];
    const flush = () => {
      if (loose.length === 0) return;
      const paragraph = this.paragraph(loose);
      if (paragraph) out.push(paragraph);
      loose = [];
    };
    for (const node of nodes) {
      if (!isElement(node) || !BLOCK_TAGS.has(node.tagName)) {
        loose.push(node);
        continue;
      }
      flush();
      out.push(...this.block(node));
    }
    flush();
    return out;
  }

  private paragraph(nodes: readonly ChildNode[]): PmNode | null {
    const content = this.inline(nodes, []);
    // A paragraph that held only a picture, or only spaces, is not text.
    const hasText = content.some(
      (n) => n.type === 'footnote' || (n.type === 'text' && (n.text ?? '').trim().length > 0),
    );
    if (!hasText) return null;
    return { type: 'paragraph', content };
  }

  private block(el: Element): PmNode[] {
    const tag = el.tagName;
    switch (tag) {
      case 'p': {
        const paragraph = this.paragraph(el.childNodes);
        return paragraph ? [paragraph] : [];
      }
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6': {
        const content = this.inline(el.childNodes, []);
        if (!content.some((n) => n.type === 'text' && (n.text ?? '').trim())) return [];
        // Level 1 is the chapter title (B.2); a Heading 1 reaching here is inside a list or a
        // table, where it cannot start a chapter, so it is a section heading.
        const level = tag === 'h1' || tag === 'h2' ? 2 : 3;
        return [{ type: 'heading', attrs: { level }, content }];
      }
      case 'ul':
      case 'ol': {
        const items = el.childNodes
          .filter((c): c is Element => isElement(c) && c.tagName === 'li')
          .map((li) => this.listItem(li));
        if (items.length === 0) return [];
        return [{ type: tag === 'ul' ? 'bulletList' : 'orderedList', content: items }];
      }
      case 'li':
        return this.blocks(el.childNodes);
      case 'table': {
        const table = this.table(el);
        return table ? [table] : [];
      }
      case 'blockquote': {
        const inner = this.blocks(el.childNodes);
        return inner.length > 0 ? [{ type: 'blockquote', content: inner }] : [];
      }
      case 'pre': {
        const text = textOf(el);
        return text.trim() ? [{ type: 'codeBlock', content: [{ type: 'text', text }] }] : [];
      }
      default:
        return this.blocks(el.childNodes);
    }
  }

  /** `listItem` is `paragraph block*`: a nested list or an empty item still starts with one. */
  private listItem(li: Element): PmNode {
    const inner = this.blocks(li.childNodes);
    if (inner[0]?.type !== 'paragraph') inner.unshift({ type: 'paragraph' });
    return { type: 'listItem', content: inner };
  }

  private table(el: Element): PmNode | null {
    const rows: PmNode[] = [];
    const collect = (parent: Element) => {
      for (const child of parent.childNodes) {
        if (!isElement(child)) continue;
        if (child.tagName === 'tr') {
          const cells = child.childNodes
            .filter((c): c is Element => isElement(c) && (c.tagName === 'td' || c.tagName === 'th'))
            .map((cell) => {
              const inner = this.blocks(cell.childNodes);
              const span = (name: string) => {
                const n = Number.parseInt(attr(cell, name) ?? '1', 10);
                return Number.isFinite(n) && n > 0 ? n : 1;
              };
              return {
                type: cell.tagName === 'th' ? 'tableHeader' : 'tableCell',
                attrs: { colspan: span('colspan'), rowspan: span('rowspan'), colwidth: null },
                content: inner.length > 0 ? inner : [{ type: 'paragraph' }],
              };
            });
          if (cells.length > 0) rows.push({ type: 'tableRow', content: cells });
        } else if (['thead', 'tbody', 'tfoot'].includes(child.tagName)) {
          collect(child);
        }
      }
    };
    collect(el);
    if (rows.length === 0) return null;
    this.tables++;
    return { type: 'table', content: rows };
  }
}

/** The entries of a reference list: its paragraphs and list items with text. */
function entriesIn(blocks: readonly PmNode[]): number {
  let entries = 0;
  for (const block of blocks) {
    if (block.type === 'paragraph') {
      if (plainText([block]).trim()) entries++;
    } else if (block.type === 'bulletList' || block.type === 'orderedList') {
      entries += (block.content ?? []).filter((item) => plainText([item]).trim()).length;
    } else if (block.type === 'blockquote') {
      entries += entriesIn(block.content ?? []);
    }
  }
  return entries;
}

/**
 * A chapter's references sections, and its blocks outside them (where citations are counted).
 *
 *   - A chapter whose Heading 1 is a references name is one whole section. `titled` is false for
 *     a title the import made up (the file's name, "Front matter"), which says nothing.
 *   - A Heading 2 or 3 with the name runs to the next heading of the same or a higher level.
 *   - A paragraph that is only the name (a bold "REFERENCES" not styled as a heading) runs to
 *     the next heading of any level.
 */
function referencesIn(
  chapter: ImportedChapter,
  titled: boolean,
): { found: ReferencesSection[]; rest: PmNode[] } {
  const heading = (text: string) => text.slice(0, REFERENCES_HEADING_MAX);
  if (titled && isReferencesHeading(chapter.title)) {
    return {
      found: [
        {
          heading: heading(chapter.title),
          chapter: chapter.title,
          entries: entriesIn(chapter.blocks),
        },
      ],
      rest: [],
    };
  }
  const found: ReferencesSection[] = [];
  const rest: PmNode[] = [];
  const { blocks } = chapter;
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i] as PmNode;
    const text = collapse(plainText([block]));
    const opens =
      (block.type === 'heading' || block.type === 'paragraph') && isReferencesHeading(text);
    if (!opens) {
      rest.push(block);
      i++;
      continue;
    }
    const level =
      block.type === 'heading' ? Number(block.attrs?.level ?? 2) : Number.POSITIVE_INFINITY;
    let end = i + 1;
    while (end < blocks.length) {
      const next = blocks[end] as PmNode;
      if (next.type === 'heading' && Number(next.attrs?.level ?? 2) <= level) break;
      end++;
    }
    found.push({
      heading: heading(text),
      chapter: chapter.title,
      entries: entriesIn(blocks.slice(i + 1, end)),
    });
    i = end;
  }
  return { found, rest };
}

/**
 * Splits mammoth's HTML into chapters. `fallbackTitle` names the one chapter of a file with no
 * Heading 1 (the file's own name, usually).
 */
export function htmlToChapters(html: string, fallbackTitle: string): DocxChapters {
  const fragment = parseFragment(html);
  const converter = new Converter();

  // Footnotes and endnotes are a list mammoth puts at the very end; read them first so a
  // reference anywhere in the text can be replaced by its note, then leave the list out.
  const top: ChildNode[] = [];
  for (const node of fragment.childNodes) {
    const items =
      isElement(node) && node.tagName === 'ol'
        ? node.childNodes.filter((c): c is Element => isElement(c) && c.tagName === 'li')
        : [];
    const notes = items.length > 0 && items.every((li) => NOTE_ID.test(attr(li, 'id') ?? ''));
    if (!notes) {
      top.push(node);
      continue;
    }
    for (const li of items) {
      // The "↑" link back to the reference is navigation, not part of the note.
      const text = collapse(textOf(li).replace(/↑/g, ''));
      converter.notes.set(attr(li, 'id') ?? '', text.slice(0, FOOTNOTE_MAX));
    }
  }

  type Draft = { title: string; nodes: ChildNode[]; preamble: boolean };
  const drafts: Draft[] = [];
  let current: Draft = { title: '', nodes: [], preamble: true };
  let headings = 0;
  for (const node of top) {
    if (isElement(node) && node.tagName === 'h1') {
      drafts.push(current);
      headings++;
      current = { title: collapse(textOf(node)), nodes: [], preamble: false };
      continue;
    }
    current.nodes.push(node);
  }
  drafts.push(current);

  const chapters: ImportedChapter[] = [];
  /** Per chapter: whether its title is a Heading 1 from the file, not one the import made up. */
  const titled: boolean[] = [];
  for (const draft of drafts) {
    const blocks = converter.blocks(draft.nodes);
    const words = wordsIn(plainText(blocks));
    // Text before the first Heading 1 is kept only when there is some; an empty preamble is
    // simply the file starting with its first chapter.
    if (draft.preamble && headings > 0 && words === 0) continue;
    const title =
      draft.preamble && headings > 0
        ? 'Front matter'
        : draft.preamble
          ? fallbackTitle
          : draft.title || `Chapter ${chapters.length + 1}`;
    chapters.push({
      title: title.slice(0, TITLE_MAX),
      blocks,
      sections: blocks
        .filter((b) => b.type === 'heading' && b.attrs?.level === 2)
        .map((b) => collapse(plainText([b])).slice(0, TITLE_MAX))
        .filter(Boolean),
      words,
      preamble: draft.preamble && headings > 0,
    });
    titled.push(!draft.preamble && draft.title.length > 0);
  }

  // Citations are counted outside the reference lists: an entry is not a citation (ADR-0113).
  const scanned = chapters.map((c, i) => referencesIn(c, titled[i] ?? false));
  const allText = scanned.map((s) => plainText(s.rest)).join(' ');
  return {
    chapters,
    splitAtHeadings: headings > 0,
    footnotes: converter.footnotes,
    tables: converter.tables,
    citationLike: countCitationLike(allText),
    references: scanned.flatMap((s) => s.found),
  };
}

/** A chapter's whole document: the level-1 title (B.2), then its blocks. */
export function chapterDoc(chapter: Pick<ImportedChapter, 'title' | 'blocks'>): {
  type: 'doc';
  content: PmNode[];
} {
  return {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: chapter.title }] },
      ...(chapter.blocks.length > 0 ? chapter.blocks : [{ type: 'paragraph' }]),
    ],
  };
}

/**
 * The words the chapter rail will show once the chapter is imported: the stored `wordCount`,
 * counted by `wordCountsOf` over the whole document, its level-1 title included. The import's
 * preview and result say this number, so the two never differ (they differed by the title's
 * words, 14 against 15, before 2026-10-09).
 */
export function chapterWords(chapter: Pick<ImportedChapter, 'title' | 'blocks'>): number {
  return totalWords(wordCountsOf(chapterDoc(chapter)));
}

/** Words in a stored chapter's body, leaving out its level-1 title — zero means "empty". */
export function bodyWords(content: unknown): number {
  const doc = content as { content?: PmNode[] } | null;
  const blocks = (doc?.content ?? []).filter(
    (b) => !(b.type === 'heading' && (b.attrs?.level ?? 1) === 1),
  );
  return wordsIn(plainText(blocks));
}
