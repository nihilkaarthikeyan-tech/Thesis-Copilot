/**
 * The paper reader (ADR-0068) — the parts that need no DOM: the address, search over text,
 * what a selection becomes when it is copied with its citation, and the hand-off to the editor.
 *
 * The page is `app/app/d/[id]/sources/[sourceId]`; the Chrome add-on deep-links to exactly that
 * path, so `readerHref` is the one place it is spelled.
 */

/**
 * `/app/d/:id/sources/:sourceId`, optionally opening at a page (`?page=4`) and marking a passage
 * (`?chunk=<SourceChunk id>`, a citation's own passage).
 */
export function readerHref(
  documentId: string,
  sourceId: string,
  page?: number | null,
  chunkId?: string | null,
): string {
  const base = `/app/d/${documentId}/sources/${sourceId}`;
  const query = new URLSearchParams();
  if (page && Number.isInteger(page) && page > 0) query.set('page', String(page));
  if (chunkId) query.set('chunk', chunkId);
  const search = query.toString();
  return search ? `${base}?${search}` : base;
}

/**
 * A selection as it should be quoted. Text from a PDF arrives with the PDF's line breaks in it
 * and with words split across lines ("hydro-\nlogy"); a quotation pasted into a thesis wants
 * neither. A hyphen at a line end joins the word; every other run of whitespace is one space.
 */
export function cleanPassage(raw: string): string {
  return raw
    .replace(/(\p{L})-\s*\n\s*(\p{Ll})/gu, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * "Copy with citation": the passage in quotation marks, then the label the thesis's own style
 * gives it (`GET /documents/:id/citations/quote`). A note style's label is the note's text, so it
 * goes on its own line rather than pretending to be an in-text label.
 */
export function quoteWithCitation(passage: string, label: string, noteStyle = false): string {
  const quoted = `“${cleanPassage(passage)}”`;
  const cite = label.trim();
  if (!cite) return quoted;
  return noteStyle ? `${quoted}\n${cite}` : `${quoted} ${cite}`;
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Jenni build plan R9: the same quotation as HTML, its citation a real citation (the editor's
 * `span[data-citation]`), so pasting into the chapter brings the citation, not just its label.
 * The label rides along (`data-label`) so it reads correctly at once; outside the app the HTML
 * reads like the plain text.
 */
export function quoteWithCitationHtml(
  passage: string,
  label: string,
  citation: { key: string; sourceId: string; page: number | null; chunkId?: string | null },
  noteStyle = false,
): string {
  const quoted = escapeHtml(`“${cleanPassage(passage)}”`);
  const cite = label.trim();
  if (!cite) return `<span>${quoted}</span>`;
  const attrs = [
    'data-citation=""',
    `data-key="${escapeHtml(citation.key)}"`,
    `data-source-id="${escapeHtml(citation.sourceId)}"`,
    ...(citation.chunkId ? [`data-chunk-id="${escapeHtml(citation.chunkId)}"`] : []),
    ...(citation.page ? [`data-locator="${citation.page}"`] : []),
    `data-label="${escapeHtml(cite)}"`,
  ].join(' ');
  return `<span>${quoted}${noteStyle ? '' : ' '}<span ${attrs}>${escapeHtml(cite)}</span></span>`;
}

/**
 * Text indexed for search: lower-cased, every run of whitespace one space, with a map from each
 * character back to where it came from. `push` takes text in reading order; a `null` origin is a
 * virtual character (the space a line break stands for), which a match may cross but which has
 * nowhere to point.
 */
export class SearchIndex<Origin> {
  text = '';
  readonly origins: Array<Origin | null> = [];

  push(chunk: string, originAt: (offset: number) => Origin | null): void {
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i] as string;
      if (/\s/.test(ch)) {
        if (this.text.length === 0 || this.text.endsWith(' ')) continue;
        this.text += ' ';
      } else {
        this.text += ch.toLowerCase();
      }
      this.origins.push(originAt(i));
    }
  }

  /** A line break or a gap between runs: a space, unless there already is one. */
  gap(): void {
    if (this.text.length === 0 || this.text.endsWith(' ')) return;
    this.text += ' ';
    this.origins.push(null);
  }
}

/** The search term as the index stores text: lower-cased, whitespace collapsed. */
export function normaliseQuery(query: string): string {
  return query.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Every start offset of `query` in `text`, without overlaps. Both already normalised. */
export function findAll(text: string, query: string): number[] {
  if (!query) return [];
  const found: number[] = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf(query, from);
    if (at === -1) return found;
    found.push(at);
    from = at + query.length;
  }
}

/** How many times `query` occurs in a page or passage of plain text. */
export function countMatches(text: string, query: string): number {
  const index = new SearchIndex<null>();
  index.push(text, () => null);
  return findAll(index.text, normaliseQuery(query)).length;
}

/** "3 of 12", "No matches", or nothing before a search is typed. */
export function matchLabel(current: number, total: number, query: string): string {
  if (!normaliseQuery(query)) return '';
  if (total === 0) return 'No matches';
  return `${Math.min(current + 1, total)} of ${total}`;
}

/** The next match after a step of +1 or -1, wrapping at both ends. */
export function stepMatch(current: number, total: number, step: 1 | -1): number {
  if (total === 0) return 0;
  return (current + step + total) % total;
}

// ---- Hand-off to the editor ---------------------------------------------------------------------

/**
 * What the reader asks the editor to do when it opens: put a citation where the student clicks,
 * or start a chat question about a passage. Kept in this tab's session storage for a minute — a
 * convenience carried across one navigation, never a record.
 */
export type ReaderHandoff =
  | {
      kind: 'cite';
      documentId: string;
      sourceId: string;
      /** The passage's chunk, when the selection came from the Text view. */
      chunkId: string | null;
      page: number | null;
      /** "Kumar 2021", for the bar that asks where the citation goes. */
      label: string;
      /** The paper's title, to find its label among the library's (`/citations/pick`). */
      title: string | null;
      /**
       * ADR-0130: the student's own note on a highlight, put in before the citation. Only ever
       * set by the student's "Put note in chapter" press, and inserted only by "Put here".
       */
      text?: string;
      at: number;
    }
  | {
      kind: 'ask';
      documentId: string;
      sourceId: string;
      text: string;
      label: string;
      /** False when nothing of the paper can be read yet; the chat chip says so. */
      readable: boolean;
      /** R13 (ADR-0100): a part of a page, already uploaded as a chat attachment. */
      attachment?: { id: string; kind: 'image'; name: string };
      /** R13: questions to offer with it, about this paper. */
      questions?: string[];
      /** ADR-0130: the student's own note on a highlight, set only by their "Put in chat". */
      note?: string;
      at: number;
    };

/**
 * R13: what to ask about a part of a page, as Jenni offers three questions for the paper with an
 * "Explain selection" box. Written from the paper's own label, with no model call.
 */
export function boxQuestions(label: string): string[] {
  const paper = label.trim() || 'this paper';
  return [
    'Explain what this part of the page shows.',
    `How does this support the main finding of ${paper}?`,
    `What are the limitations of ${paper}?`,
    `Summarize ${paper} in five sentences.`,
  ];
}

const HANDOFF_KEY = 'tc:reader-handoff';
export const HANDOFF_TTL_MS = 60_000;

/** Distributes `Omit` over the union, so each kind keeps its own fields. */
type WithoutAt<T> = T extends unknown ? Omit<T, 'at'> : never;

export function writeHandoff(handoff: WithoutAt<ReaderHandoff>, now = Date.now()): void {
  try {
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({ ...handoff, at: now }));
  } catch {
    // Blocked storage: the editor simply opens as it would have.
  }
}

/** Reads and removes the hand-off for this thesis, if there is a fresh one. */
export function takeHandoff(documentId: string, now = Date.now()): ReaderHandoff | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(HANDOFF_KEY);
    if (raw) sessionStorage.removeItem(HANDOFF_KEY);
  } catch {
    return null;
  }
  return parseHandoff(raw, documentId, now);
}

export function parseHandoff(
  raw: string | null,
  documentId: string,
  now = Date.now(),
): ReaderHandoff | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<ReaderHandoff>;
    if (value.documentId !== documentId || typeof value.sourceId !== 'string') return null;
    if (typeof value.at !== 'number' || now - value.at > HANDOFF_TTL_MS) return null;
    if (value.kind === 'cite' || value.kind === 'ask') return value as ReaderHandoff;
    return null;
  } catch {
    return null;
  }
}

// ---- The library, matched ------------------------------------------------------------------------

/** A DOI as the library compares them: lower case, no resolver prefix. */
export function normaliseDoi(doi: string | null | undefined): string | null {
  if (!doi) return null;
  const bare = doi
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .toLowerCase();
  return bare || null;
}

/**
 * The library row a search result or a chat paper is, when it is in the library: by DOI, else by
 * the exact reference it was added from. Used to put "Read" on a paper once it has been added.
 */
export function findInLibrary<
  T extends { id: string; doi?: string | null; rawReference?: string | null },
>(
  library: readonly T[],
  paper: { doi?: string | null; reference?: { raw: string } | null },
): T | undefined {
  const doi = normaliseDoi(paper.doi);
  return library.find(
    (s) =>
      (doi !== null && normaliseDoi(s.doi) === doi) ||
      (!!paper.reference?.raw && s.rawReference === paper.reference.raw),
  );
}
