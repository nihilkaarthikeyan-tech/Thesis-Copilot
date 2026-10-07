/**
 * The "Edit details" form's shape (Jenni build plan R15, ADR-0102): which fields each kind of
 * source has, in the words a student uses, and the author lines ("Family, Given" per line, a name
 * with no comma an organisation). The server's twin is `@tc/citations` `details.ts`.
 */

export type DetailName = { family?: string; given?: string; literal?: string };

export type SourceDetails = {
  type: string;
  title: string;
  authors: DetailName[];
  year: number | null;
  container: string;
  volume: string;
  issue: string;
  pages: string;
  publisher: string;
  doi: string;
  url: string;
};

export type DetailField = 'container' | 'volume' | 'issue' | 'pages' | 'publisher' | 'doi' | 'url';

/** Each kind, its name, and its fields beyond title, authors and year (with their labels). */
export const DETAIL_KINDS: Array<{
  type: string;
  name: string;
  fields: Array<{ key: DetailField; label: string }>;
}> = [
  {
    type: 'article-journal',
    name: 'Journal article',
    fields: [
      { key: 'container', label: 'Journal' },
      { key: 'volume', label: 'Volume' },
      { key: 'issue', label: 'Issue' },
      { key: 'pages', label: 'Pages' },
      { key: 'doi', label: 'DOI' },
    ],
  },
  {
    type: 'book',
    name: 'Book',
    fields: [
      { key: 'publisher', label: 'Publisher' },
      { key: 'doi', label: 'DOI' },
      { key: 'url', label: 'Link' },
    ],
  },
  {
    type: 'chapter',
    name: 'Book chapter',
    fields: [
      { key: 'container', label: 'Book title' },
      { key: 'pages', label: 'Pages' },
      { key: 'publisher', label: 'Publisher' },
      { key: 'doi', label: 'DOI' },
    ],
  },
  {
    type: 'paper-conference',
    name: 'Conference paper',
    fields: [
      { key: 'container', label: 'Conference' },
      { key: 'pages', label: 'Pages' },
      { key: 'doi', label: 'DOI' },
    ],
  },
  {
    type: 'thesis',
    name: 'Thesis',
    fields: [
      { key: 'publisher', label: 'University' },
      { key: 'url', label: 'Link' },
    ],
  },
  {
    type: 'report',
    name: 'Report',
    fields: [
      { key: 'publisher', label: 'Institution' },
      { key: 'doi', label: 'DOI' },
      { key: 'url', label: 'Link' },
    ],
  },
  {
    type: 'webpage',
    name: 'Web page',
    fields: [
      { key: 'container', label: 'Website' },
      { key: 'url', label: 'Link' },
    ],
  },
];

/** "Kumar, Asha" / "World Health Organization" — one author per line. */
export function authorLines(authors: readonly DetailName[]): string {
  return authors
    .map((a) =>
      a.literal ? a.literal : [a.family ?? '', a.given ?? ''].filter(Boolean).join(', '),
    )
    .join('\n');
}

/** The lines back into names: "Family, Given", or a name with no comma as an organisation. */
export function parseAuthorLines(lines: string): DetailName[] {
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
