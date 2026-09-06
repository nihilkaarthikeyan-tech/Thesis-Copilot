/**
 * `Source` → CSL-JSON — PRD §8 (`Source.cslJson`), FR-5.2.
 *
 * Resolution stores the publisher's own CSL-JSON on the source when Crossref or OpenAlex gave
 * one. This fills the gaps: an unresolved source, or one whose CSL-JSON is missing the fields a
 * style needs, still has a title, authors and a year on the row. Nothing is invented — a field
 * absent from both the CSL-JSON and the row is absent from the output, and citeproc renders what
 * that style does for a missing field.
 */

export type CslName = { family?: string; given?: string; literal?: string };

export type CslItem = {
  id: string;
  type: string;
  title?: string;
  author?: CslName[];
  issued?: { 'date-parts': number[][] };
  'container-title'?: string;
  DOI?: string;
  URL?: string;
  publisher?: string;
  volume?: string;
  issue?: string;
  page?: string;
  abstract?: string;
  [key: string]: unknown;
};

/** The subset of a `Source` row this needs; anything else is ignored. */
export type SourceLike = {
  id: string;
  title?: string | null;
  authors?: unknown;
  year?: number | null;
  venue?: string | null;
  doi?: string | null;
  cslJson?: unknown;
  isPreprint?: boolean | null;
  rawReference?: string | null;
};

/** CSL type from what is known. Everything scholarly here is an article unless it says otherwise. */
function typeOf(source: SourceLike, stored: Record<string, unknown> | null): string {
  const type = stored?.type;
  if (typeof type === 'string' && type.length > 0) return type;
  if (source.isPreprint) return 'article';
  return source.venue ? 'article-journal' : 'document';
}

/** `Source.authors` is `[{ family, given }]` or a list of strings, depending on where it came from. */
export function namesFrom(authors: unknown): CslName[] {
  if (!Array.isArray(authors)) return [];
  return authors
    .map((entry): CslName | null => {
      if (typeof entry === 'string') {
        const name = entry.trim();
        if (!name) return null;
        // "Kumar, A." keeps its comma order; "A. Kumar" does not get re-split, because guessing
        // which half is the family name is how citations end up wrong.
        const [family, given] = name.split(',').map((p) => p.trim());
        return given ? { family, given } : { literal: name };
      }
      if (entry && typeof entry === 'object') {
        const { family, given, literal, name } = entry as Record<string, unknown>;
        if (typeof family === 'string' || typeof given === 'string') {
          return {
            ...(typeof family === 'string' ? { family } : {}),
            ...(typeof given === 'string' ? { given } : {}),
          };
        }
        const flat = literal ?? name;
        if (typeof flat === 'string' && flat.trim()) return { literal: flat.trim() };
      }
      return null;
    })
    .filter((n): n is CslName => n !== null);
}

/**
 * One CSL-JSON item for citeproc. The stored CSL-JSON wins field by field; the row fills what it
 * does not have. The id is the source id, so a rendered label can always be traced back to a row.
 */
export function toCslItem(source: SourceLike): CslItem {
  const stored =
    source.cslJson && typeof source.cslJson === 'object' && !Array.isArray(source.cslJson)
      ? ({ ...(source.cslJson as Record<string, unknown>) } as Record<string, unknown>)
      : null;

  const item: CslItem = {
    ...(stored ?? {}),
    id: source.id,
    type: typeOf(source, stored),
  };

  const title = stored?.title ?? source.title;
  if (typeof title === 'string' && title.trim()) item.title = title.trim();
  else if (source.rawReference) item.title = source.rawReference.slice(0, 300);

  const storedAuthors = namesFrom(stored?.author);
  const authors = storedAuthors.length > 0 ? storedAuthors : namesFrom(source.authors);
  if (authors.length > 0) item.author = authors;
  else delete item.author;

  const storedYear = (stored?.issued as { 'date-parts'?: number[][] } | undefined)?.[
    'date-parts'
  ]?.[0]?.[0];
  const year = typeof storedYear === 'number' ? storedYear : source.year;
  if (typeof year === 'number' && Number.isFinite(year)) item.issued = { 'date-parts': [[year]] };
  else delete item.issued;

  const venue = stored?.['container-title'] ?? source.venue;
  if (typeof venue === 'string' && venue.trim()) item['container-title'] = venue.trim();

  const doi = stored?.DOI ?? source.doi;
  if (typeof doi === 'string' && doi.trim()) item.DOI = doi.trim();

  // The abstract is stored for retrieval, not for a bibliography; APA would print it.
  delete item.abstract;
  return item;
}
