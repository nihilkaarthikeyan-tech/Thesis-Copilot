/**
 * The library, as a file a student can take somewhere else.
 *
 * Import has existed since FR-2.9 (`.bib` and `.ris` from Zotero or Mendeley). Export did not, so a
 * library built here could not leave: a student who finished, or switched tools, or just wanted
 * their references in a reference manager, had no way out. That is a lock-in the product has no
 * business having, and §12.2's data-portability promise does not stop at the thesis text.
 *
 * Three formats, for three different destinations:
 *
 *   - **BibTeX** — for LaTeX, and the one format every reference manager imports.
 *   - **RIS** — what Zotero, Mendeley, EndNote and most library catalogues exchange.
 *   - **CSV** — for a spreadsheet, which is how a student checks a supervisor's "have you read
 *     X?" against what is actually in the library.
 *
 * BibTeX and RIS are written by citation-js, the library the product already renders citations
 * with. BibTeX escaping is where hand-written exporters go wrong — an umlaut, a brace in a title,
 * an ampersand — and citation-js already handles every one of those.
 */

import { plugins } from '@citation-js/core';
import '@citation-js/plugin-bibtex';
import '@citation-js/plugin-ris';
import { type CslItem, type SourceLike, toCslItem } from './csl.js';

export type LibraryFormat = 'bib' | 'ris' | 'csv';

/** What the export knows about a source beyond what citations need. */
export type LibrarySource = SourceLike & {
  /** `RESOLVED`, `UNRESOLVED`, … — an unresolved one is exported, and marked. */
  status?: string | null;
  citationCount?: number | null;
  isRetracted?: boolean | null;
  groundingLevel?: string | null;
  oaStatus?: string | null;
};

export type LibraryFile = { body: string; mimeType: string; extension: string };

/** What an entry says about itself when it is not a verified record. Keyed by `SourceStatus`. */
const STATUS_NOTE: Record<string, string> = {
  UNRESOLVED:
    'Not identified: Thesis Copilot could not match this reference to a published record. Check it before citing.',
  FAILED:
    'Not identified: Thesis Copilot could not match this reference to a published record. Check it before citing.',
  // Still in the lookup queue when the file was written. Not a failure, and not verified either.
  PENDING:
    'Not yet verified: this reference was still being looked up when the library was exported.',
};

/** Letters and digits only, with accents folded: `Müller` → `Muller`, as BibTeX keys need. */
function asciiWord(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]/g, '');
}

/** Words too common to identify a title by, skipped when choosing the key's title part. */
const STOP_WORDS = new Set(['a', 'an', 'the', 'on', 'of', 'in', 'and', 'for', 'to', 'with']);

function baseKey(item: CslItem): string {
  const family = (item.author as Array<{ family?: string; literal?: string }> | undefined)?.[0];
  const name = asciiWord(family?.family ?? family?.literal?.split(/\s+/).pop() ?? '');
  const year = (item.issued as { 'date-parts'?: number[][] } | undefined)?.['date-parts']?.[0]?.[0];
  const titleWord =
    String(item.title ?? '')
      .split(/\s+/)
      .map(asciiWord)
      .find((word) => word.length > 0 && !STOP_WORDS.has(word.toLowerCase())) ?? '';
  const key = `${name}${year ?? ''}${titleWord}`;
  return key || 'ref';
}

/**
 * A citation key for every source — unique, and stable across exports.
 *
 * Stable because a student who exports, writes `\cite{LeCun2015Deep}` in a LaTeX file, and exports
 * again next month must get the same key back: the caller passes sources in a fixed order (when
 * they were added), and the first source to claim a key keeps it. Later collisions get `b`, `c`…
 *
 * The LaTeX export uses this same function, so its `\cite{}` keys match this `.bib` exactly.
 */
export function citationKeys(sources: readonly SourceLike[]): Map<string, string> {
  const keys = new Map<string, string>();
  const taken = new Set<string>();
  for (const source of sources) {
    const base = baseKey(toCslItem(source));
    let key = base;
    for (let n = 1; taken.has(key); n++) key = `${base}${String.fromCharCode(97 + n)}`;
    taken.add(key);
    keys.set(source.id, key);
  }
  return keys;
}

function itemsFor(sources: readonly LibrarySource[]): CslItem[] {
  const keys = citationKeys(sources);
  return sources.map((source) => {
    const item = toCslItem(source);
    const key = keys.get(source.id) ?? 'ref';
    // The source's own id is an internal UUID; in a file somebody else will read, the key is the
    // identifier that means something. RIS writes `id` as its `ID` field.
    item.id = key;
    item['citation-key'] = key;
    const note = source.status ? STATUS_NOTE[source.status] : undefined;
    if (note) item.note = note;
    if (source.isRetracted) item.note = 'RETRACTED — do not cite without saying so.';
    return item;
  });
}

// ---------------------------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------------------------

const CSV_COLUMNS = [
  'Key',
  'Title',
  'Authors',
  'Year',
  'Venue',
  'DOI',
  'Type',
  'Citations',
  'Preprint',
  'Retracted',
  'Status',
  'Grounding',
  'Open access',
] as const;

/**
 * One CSV field, RFC 4180 quoted, and defused against formula injection.
 *
 * A title is data somebody else wrote. One that begins with `=`, `+`, `-` or `@` is executed by a
 * spreadsheet that opens the file ("=HYPERLINK(...)"); prefixing a single quote makes it inert
 * text, which is what OWASP recommends and what every spreadsheet displays as the plain value.
 */
export function csvField(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function authorsText(item: CslItem): string {
  const names = (item.author as Array<{ family?: string; given?: string; literal?: string }>) ?? [];
  return names
    .map((name) => name.literal ?? [name.family, name.given].filter(Boolean).join(', '))
    .join('; ');
}

function toCsv(sources: readonly LibrarySource[]): string {
  const keys = citationKeys(sources);
  const rows = sources.map((source) => {
    const item = toCslItem(source);
    const year = (item.issued as { 'date-parts'?: number[][] } | undefined)?.[
      'date-parts'
    ]?.[0]?.[0];
    return [
      keys.get(source.id),
      item.title,
      authorsText(item),
      year,
      item['container-title'],
      item.DOI ?? source.doi,
      item.type,
      source.citationCount,
      source.isPreprint ? 'yes' : 'no',
      source.isRetracted ? 'yes' : 'no',
      source.status,
      source.groundingLevel,
      source.oaStatus,
    ]
      .map(csvField)
      .join(',');
  });
  // CRLF, as RFC 4180 specifies and as Excel expects; and a byte-order mark, without which Excel
  // opens a UTF-8 file as Windows-1252 and every accented author name arrives mangled.
  return `\uFEFF${[CSV_COLUMNS.join(','), ...rows].join('\r\n')}\r\n`;
}

// ---------------------------------------------------------------------------------------------

export function exportLibrary(
  sources: readonly LibrarySource[],
  format: LibraryFormat,
): LibraryFile {
  switch (format) {
    case 'bib':
      return {
        body: String(plugins.output.format('bibtex', itemsFor(sources), { format: 'text' })),
        mimeType: 'application/x-bibtex; charset=utf-8',
        extension: 'bib',
      };
    case 'ris':
      return {
        body: String(plugins.output.format('ris', itemsFor(sources), { format: 'text' })),
        mimeType: 'application/x-research-info-systems; charset=utf-8',
        extension: 'ris',
      };
    case 'csv':
      return { body: toCsv(sources), mimeType: 'text/csv; charset=utf-8', extension: 'csv' };
  }
}
