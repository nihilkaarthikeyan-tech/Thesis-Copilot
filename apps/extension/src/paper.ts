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
  /** `document.contentType` — `application/pdf` when Chrome shows a PDF and the tab can be read. */
  contentType?: string;
};

export type Paper = {
  title: string;
  doi: string | null;
  /** A readable reference — what the library resolves by when there is no DOI. */
  reference: string;
  /** For the card only: "LeCun, Bengio, Hinton", the year and the journal, when the page says. */
  byline?: string | null;
  year?: string | null;
  venue?: string | null;
};

/** Builds the reference line the library resolves by: authors (year). Title. Venue. DOI link. */
export function referenceLine(parts: {
  byline: string | null;
  year: string | null;
  title: string | null;
  venue: string | null;
  doi: string | null;
}): string {
  const { byline, year, title, venue, doi } = parts;
  // "…et al." already ends in a full stop; a second would print "et al..".
  const endStop = (text: string) => (text.endsWith('.') ? text : `${text}.`);
  return [
    byline ? endStop(`${byline}${year ? ` (${year})` : ''}`) : year ? `(${year}).` : null,
    title ? `${title.replace(/[.\s]+$/, '')}.` : null,
    venue ? `${venue}.` : null,
    doi ? `https://doi.org/${doi}` : null,
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, 1_000);
}

/** "A, B, C et al." for more than three names, as a reference writes it. */
export function shortByline(authors: readonly string[]): string | null {
  if (authors.length === 0) return null;
  return authors.length > 3 ? `${authors.slice(0, 3).join(', ')} et al.` : authors.join(', ');
}

/**
 * A DOI as the add-on will send one: the `10.` prefix, a slash, then printable characters with no
 * space, quote or angle bracket, at most 200 long (the API's own limit for a typed DOI). Anything a
 * page writes is untrusted, so a value that does not fit this is dropped, not repaired.
 */
const DOI_SHAPE = /^10\.\d{4,9}\/[^\s"'<>\\]+$/;
export const DOI_MAX = 200;

/** True when `value` is already a DOI the add-on may send. */
export function isDoi(value: string): boolean {
  return value.length <= DOI_MAX && DOI_SHAPE.test(value);
}

/** arXiv identifiers: `2410.08098` (2007 on) and `hep-th/9901001` (before). */
const ARXIV_NEW = /^\d{4}\.\d{4,5}$/;
const ARXIV_OLD = /^[a-z-]+(?:\.[A-Z]{2})?\/\d{7}$/;

/** An arXiv id without its version, or null when the value is not one. */
export function cleanArxivId(value: string): string | null {
  const id = value
    .trim()
    .replace(/^arxiv:\s*/i, '')
    .replace(/v\d+$/, '');
  return ARXIV_NEW.test(id) || ARXIV_OLD.test(id) ? id : null;
}

/** A PubMed id: digits only, at most nine of them. */
export function cleanPmid(value: string): string | null {
  const id = value.trim();
  return /^[1-9]\d{0,8}$/.test(id) ? id : null;
}

/** Text from a page, with runs of whitespace made one space and cut to `max` characters. */
export function clip(value: string | null | undefined, max: number): string {
  // `\p{Cc}`: the control characters (tabs, newlines, NUL…), which no title or name contains.
  return (value ?? '')
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

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
  return isDoi(doi) ? doi : null;
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
  return match?.[1] ? cleanArxivId(match[1]) : null;
}

/** A DOI in the address itself: doi.org links, publishers' `/doi/…` paths, and `?id=10.…` values. */
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
  if (match?.[1]) return cleanDoi(match[1]);
  // A DOI as a query value: PLOS's `article/file?id=10.1371/…&type=printable`, `?doi=10.…`.
  for (const value of parsed.searchParams.values()) {
    if (/^10\.\d{4,9}\/\S+$/.test(value.trim())) return cleanDoi(value.trim());
  }
  return null;
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

  const title = clip(
    scholarlyTitle ?? first(meta, ['og:title', 'twitter:title']) ?? page.title ?? '',
    500,
  );

  const byline = shortByline(all(meta, 'citation_author').map((a) => clip(a, 120)));
  const date = first(meta, [
    'citation_publication_date',
    'citation_date',
    'citation_online_date',
    'citation_year',
    'dc.date',
    'prism.publicationdate',
  ]);
  const year = date ? (/\b(1[89]\d\d|20\d\d)\b/.exec(date)?.[1] ?? null) : null;
  const venueTag = first(meta, [
    'citation_journal_title',
    'citation_conference_title',
    'prism.publicationname',
  ]);
  const venue = venueTag ? clip(venueTag, 200) : null;

  const reference = referenceLine({ byline, year, title, venue, doi });
  return {
    title: title || (doi ?? ''),
    doi,
    reference: reference || (doi ?? title),
    byline,
    year,
    venue,
  };
}

/**
 * The paper a link points at — for the right-click "Add to Thesis Copilot" (ADR-0069). Only a
 * link that names the paper itself counts: a DOI (doi.org or a publisher's `/doi/…` path) or an
 * arXiv abstract or PDF. A PubMed link carries only its PMID, which the library cannot look up,
 * so it is not offered.
 */
export function paperFromLink(url: string): Paper | null {
  const arxivId = arxivIdFromPageUrl(url);
  const doi = doiFromUrl(url) ?? (arxivId ? arxivDoi(arxivId) : null);
  if (!doi) return null;
  return {
    title: arxivId ? `arXiv:${arxivId}` : `DOI ${doi}`,
    doi,
    reference: `https://doi.org/${doi}`,
    byline: null,
    year: null,
    venue: null,
  };
}

/** True when the address is a PDF: a `.pdf` path, or arXiv's and publishers' PDF routes. */
export function isPdfUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  const path = parsed.pathname.toLowerCase();
  return (
    path.endsWith('.pdf') ||
    (/(^|\.)arxiv\.org$/i.test(parsed.hostname) && path.startsWith('/pdf/')) ||
    /\/doi\/(?:pdf|epdf|pdfdirect)\//.test(path)
  );
}

/** The name the PDF is uploaded under: the address's last part, made safe, ending in `.pdf`. */
export function pdfFilename(url: string): string {
  let last = 'paper';
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    last = decodeURIComponent(segments[segments.length - 1] ?? 'paper');
  } catch {
    // Keep "paper".
  }
  const base =
    last
      .replace(/\.pdf$/i, '')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .slice(0, 100) || 'paper';
  return `${base}.pdf`;
}
