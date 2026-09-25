/**
 * Which paper a page is about — ADR-0031.
 *
 * Journals, publishers and indexes describe the article on the page in `<meta>` tags for Google
 * Scholar (`citation_doi`, `citation_title`, `citation_author`…), and many carry the DOI in the
 * address too. This reads those and nothing else: never the page's text, where the reference list
 * is full of other papers' DOIs and the first one found would be the wrong paper.
 *
 * Pure, so it is tested without a browser; `page.ts` gathers the tags inside the tab.
 */

/** What `collectPageMeta` returns from the tab: the address, the title, every meta tag. */
export type PageMeta = {
  url: string;
  title: string;
  /** `[name or property, content]`, names lower-cased, in page order. */
  meta: Array<[string, string]>;
};

export type Paper = {
  title: string;
  doi: string | null;
  /** A readable reference — what the library resolves by when there is no DOI. */
  reference: string;
};

const DOI_SHAPE = /^10\.\d{4,9}\/\S+$/;

/** A DOI from any of the ways pages write one, or null when the value is not a DOI. */
export function cleanDoi(value: string): string | null {
  let doi = value.trim();
  try {
    doi = decodeURIComponent(doi);
  } catch {
    // A stray `%` is not worth failing over; the shape check below decides.
  }
  doi = doi
    .replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .replace(/[.,;:)\]}>'"]+$/, '');
  return DOI_SHAPE.test(doi) ? doi : null;
}

/** The DOI arXiv registers for an e-print: the same string `@tc/retrieval`'s `arxivDoi` makes. */
export function arxivDoi(id: string): string {
  return `10.48550/arxiv.${id.toLowerCase()}`;
}

/** `https://arxiv.org/abs/2410.08098v2` or `/pdf/2410.08098v2` → `2410.08098`. */
export function arxivIdFromPageUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!/(^|\.)arxiv\.org$/i.test(parsed.hostname)) return null;
  const match = /^\/(?:abs|pdf)\/(.+?)(?:v\d+)?(?:\.pdf)?\/?$/i.exec(parsed.pathname);
  return match?.[1] ?? null;
}

/** A DOI in the address itself: doi.org links, and publishers' `/doi/…` article paths. */
export function doiFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (/(^|\.)doi\.org$/i.test(parsed.hostname)) return cleanDoi(parsed.pathname.slice(1));
  let path = parsed.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // Keep the raw path.
  }
  const match =
    /\/doi\/(?:(?:abs|full|pdf|epdf|pdfdirect|reader|book)\/)?(10\.\d{4,9}\/[^?#\s]+)/i.exec(path);
  return match?.[1] ? cleanDoi(match[1]) : null;
}

/** Tags that name the article's own DOI, strongest first. */
const DOI_TAGS = [
  'citation_doi',
  'prism.doi',
  'bepress_citation_doi',
  'dc.identifier.doi',
  'dc.identifier',
  'dcterms.identifier',
  'doi',
];

/** Tags that only a scholarly page carries: a title in one of these makes the page a paper. */
const TITLE_TAGS = ['citation_title', 'dc.title', 'dcterms.title', 'prism.title'];

const first = (meta: PageMeta['meta'], names: readonly string[]): string | null => {
  for (const name of names) {
    const hit = meta.find(([key, value]) => key === name && value.trim());
    if (hit) return hit[1].trim();
  }
  return null;
};

const all = (meta: PageMeta['meta'], name: string): string[] =>
  meta.filter(([key, value]) => key === name && value.trim()).map(([, value]) => value.trim());

/** The paper on the page, or null when the page is not about one paper. */
export function paperFrom(page: PageMeta): Paper | null {
  const { meta } = page;
  let doi: string | null = null;
  for (const name of DOI_TAGS) {
    for (const value of all(meta, name)) {
      doi = cleanDoi(value);
      if (doi) break;
    }
    if (doi) break;
  }
  doi ??= doiFromUrl(page.url);
  const arxivId = arxivIdFromPageUrl(page.url);
  if (!doi && arxivId) doi = arxivDoi(arxivId);

  const scholarlyTitle = first(meta, TITLE_TAGS);
  // Every web page has a title; only a DOI or a scholarly title says this one is a paper.
  if (!doi && !scholarlyTitle) return null;

  const title = (
    scholarlyTitle ??
    first(meta, ['og:title', 'twitter:title']) ??
    page.title ??
    ''
  ).slice(0, 500);

  const authors = all(meta, 'citation_author');
  const byline =
    authors.length === 0
      ? null
      : authors.length > 3
        ? `${authors.slice(0, 3).join(', ')} et al.`
        : authors.join(', ');
  const date = first(meta, [
    'citation_publication_date',
    'citation_date',
    'citation_online_date',
    'citation_year',
    'dc.date',
    'prism.publicationdate',
  ]);
  const year = date ? (/\b(1[89]\d\d|20\d\d)\b/.exec(date)?.[1] ?? null) : null;
  const venue = first(meta, [
    'citation_journal_title',
    'citation_conference_title',
    'prism.publicationname',
  ]);

  // "…et al." already ends in a full stop; a second would print "et al..".
  const endStop = (text: string) => (text.endsWith('.') ? text : `${text}.`);
  const reference = [
    byline ? endStop(`${byline}${year ? ` (${year})` : ''}`) : year ? `(${year}).` : null,
    title ? `${title.replace(/[.\s]+$/, '')}.` : null,
    venue ? `${venue}.` : null,
    doi ? `https://doi.org/${doi}` : null,
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, 1_000);

  return { title: title || (doi ?? ''), doi, reference: reference || (doi ?? title) };
}
