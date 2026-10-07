/**
 * A paper's details as the student edits them (Jenni build plan R15, ADR-0102), and back into the
 * stored CSL record. The stored CSL-JSON wins over the row's own columns when a citation is built
 * (`toCslItem`), so an edit is written to both; every citation of the paper follows on its next
 * render, in every chapter and the bibliography.
 */

import { type CslName, EDITED_KEY, type SourceLike, toCslItem } from './csl.js';

/** The kinds a student chooses between, with the CSL type each is. */
export const DETAIL_TYPES = [
  'article-journal',
  'book',
  'chapter',
  'paper-conference',
  'thesis',
  'report',
  'webpage',
] as const;
export type DetailType = (typeof DETAIL_TYPES)[number];

export type SourceDetails = {
  type: DetailType;
  title: string;
  /** In order; a person as family and given names, an organisation as `literal`. */
  authors: CslName[];
  year: number | null;
  /** The journal, the book a chapter is in, the conference, or the website. */
  container: string;
  volume: string;
  issue: string;
  pages: string;
  /** The publisher, the university (a thesis) or the institution (a report). */
  publisher: string;
  doi: string;
  url: string;
};

const text = (value: unknown): string =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';

/** The form's values for a source, from what a citation of it would print now. */
export function detailsOf(source: SourceLike): SourceDetails {
  const item = toCslItem(source) as Record<string, unknown>;
  const type = (DETAIL_TYPES as readonly string[]).includes(String(item.type))
    ? (item.type as DetailType)
    : 'article-journal';
  const year = (item.issued as { 'date-parts'?: number[][] } | undefined)?.['date-parts']?.[0]?.[0];
  return {
    type,
    title: text(item.title),
    authors: Array.isArray(item.author) ? (item.author as CslName[]) : [],
    year: typeof year === 'number' ? year : null,
    container: text(item['container-title']),
    volume: text(item.volume),
    issue: text(item.issue),
    pages: text(item.page),
    publisher: text(item.publisher),
    doi: text(item.DOI),
    url: text(item.URL),
  };
}

/**
 * The stored CSL record with the student's details written in. Fields the form has are set (or
 * removed when emptied); anything else the record carries (an abstract, an ISSN…) is kept.
 */
export function withDetails(cslJson: unknown, details: SourceDetails): Record<string, unknown> {
  const out: Record<string, unknown> =
    cslJson && typeof cslJson === 'object' && !Array.isArray(cslJson)
      ? { ...(cslJson as Record<string, unknown>) }
      : {};
  const set = (key: string, value: string) => {
    const v = value.trim();
    if (v) out[key] = v;
    else delete out[key];
  };
  out.type = details.type;
  // Printed as the student wrote it from now on (`toCslItem`).
  out[EDITED_KEY] = true;
  set('title', details.title);
  // A subtitle Crossref kept apart is now part of the title the student wrote.
  delete out.subtitle;
  const authors = details.authors
    .map((a) =>
      a.literal?.trim()
        ? { literal: a.literal.trim() }
        : {
            ...(a.family?.trim() ? { family: a.family.trim() } : {}),
            ...(a.given?.trim() ? { given: a.given.trim() } : {}),
          },
    )
    .filter((a) => Object.keys(a).length > 0);
  if (authors.length > 0) out.author = authors;
  else delete out.author;
  if (details.year !== null) out.issued = { 'date-parts': [[details.year]] };
  else delete out.issued;
  set('container-title', details.container);
  delete out['short-container-title'];
  set('volume', details.volume);
  set('issue', details.issue);
  set('page', details.pages);
  set('publisher', details.publisher);
  set('DOI', details.doi);
  set('URL', details.url);
  return out;
}

/** "Kumar, Asha" / "World Health Organization" — one author per line, as the form shows them. */
export function authorLines(authors: readonly CslName[]): string {
  return authors
    .map((a) =>
      a.literal ? a.literal : [a.family ?? '', a.given ?? ''].filter(Boolean).join(', '),
    )
    .join('\n');
}

/** The form's lines back into names: "Family, Given", or a name with no comma as an organisation. */
export function parseAuthorLines(lines: string): CslName[] {
  return lines
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const comma = line.indexOf(',');
      if (comma < 0) return { literal: line };
      const family = line.slice(0, comma).trim();
      const given = line.slice(comma + 1).trim();
      return given ? { family, given } : { family };
    });
}
