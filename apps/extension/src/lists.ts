/**
 * The papers on a results page — ADR-0069. `page.ts` collects what each result shows; this turns
 * it into papers the library can look up, and drops whatever does not check out.
 *
 * Pure, so each site's markup is tested from a saved page without a browser.
 *
 * What each site gives:
 * - PubMed: the PMID, the title, the authors and the journal line, which carries the DOI for most
 *   records ("Radiology. 2024 Jul;312(1):e232085. doi: 10.1148/radiol.232085.").
 * - arXiv: the arXiv id, so the DOI arXiv registers (`10.48550/arxiv.<id>`).
 * - Google Scholar: only the title, the "authors - venue, year - host" line and the link the
 *   title points to; a DOI only when that link has one in it. The rest are looked up by their
 *   text, which the library matches strictly or leaves unresolved, never guesses.
 */

import {
  arxivDoi,
  arxivIdFromPageUrl,
  cleanArxivId,
  cleanDoi,
  cleanPmid,
  clip,
  doiFromUrl,
  type Paper,
  referenceLine,
} from './paper.js';

export type Site = 'pubmed' | 'arxiv' | 'scholar';

/** One result as `collectResultList` read it: raw strings, any of them possibly empty. */
export type RawResult = {
  title: string;
  byline: string;
  /** PubMed's journal line, arXiv's "Submitted …" line; empty on Scholar. */
  citation: string;
  pmid: string;
  arxivId: string;
  /** Where the result's title links to, absolute. */
  href: string;
};

export type RawListing = { site: Site; items: RawResult[] };

export type ListItem = Paper & {
  /** What makes two results one paper on this page: the DOI, else the PMID, else the title. */
  key: string;
};

/** The most one save sends — a page of results, not a library. */
export const BULK_MAX = 50;

const SITE_NAMES: Record<Site, string> = {
  pubmed: 'PubMed',
  arxiv: 'arXiv',
  scholar: 'Google Scholar',
};

export const siteName = (site: Site): string => SITE_NAMES[site];

const yearIn = (value: string): string | null => /\b(1[89]\d\d|20\d\d)\b/.exec(value)?.[1] ?? null;

/** "Misera L, Müller-Franzes G, Truhn D, Kather JN." → at most three names, then "et al.". */
function byline(raw: string): string | null {
  const names = clip(raw, 2_000)
    .replace(/[.\s]+$/, '')
    .replace(/\s*…\s*$/, '')
    .split(/\s*,\s*/)
    .map((name) => clip(name, 120))
    .filter(Boolean);
  if (names.length === 0) return null;
  return names.length > 3 ? `${names.slice(0, 3).join(', ')} et al.` : names.join(', ');
}

function fromPubmed(raw: RawResult): ListItem | null {
  const title = clip(raw.title, 500).replace(/\.$/, '');
  const pmid = cleanPmid(raw.pmid);
  const citation = clip(raw.citation, 600);
  const doiMatch = /\bdoi:\s*(10\.\d{4,9}\/\S+)/i.exec(citation);
  const doi = doiMatch?.[1] ? cleanDoi(doiMatch[1]) : null;
  if (!title && !doi) return null;
  // The journal is the line up to its first full stop: "Radiology. 2024 Jul;…".
  const venue = clip(citation.split('.')[0], 200) || null;
  const year = yearIn(citation);
  const authors = byline(raw.byline);
  return {
    key: doi ?? (pmid ? `pmid:${pmid}` : `title:${title.toLowerCase()}`),
    title: title || (doi ?? ''),
    doi,
    byline: authors,
    year,
    venue,
    reference: referenceLine({ byline: authors, year, title, venue, doi }),
  };
}

function fromArxiv(raw: RawResult): ListItem | null {
  // The link decides: an id is taken only from a link to arXiv itself.
  const id = raw.href ? arxivIdFromPageUrl(raw.href) : cleanArxivId(raw.arxivId);
  if (!id) return null;
  const doi = arxivDoi(id);
  const title = clip(raw.title, 500);
  const authors = byline(raw.byline);
  const year = yearIn(raw.citation);
  return {
    key: doi,
    title: title || `arXiv:${id}`,
    doi,
    byline: authors,
    year,
    venue: 'arXiv',
    reference: referenceLine({ byline: authors, year, title, venue: 'arXiv', doi }),
  };
}

function fromScholar(raw: RawResult): ListItem | null {
  const title = clip(raw.title, 500);
  if (!title) return null;
  const arxivId = raw.href ? arxivIdFromPageUrl(raw.href) : null;
  const doi = raw.href ? (doiFromUrl(raw.href) ?? (arxivId ? arxivDoi(arxivId) : null)) : null;
  // "A Author, B Author - Journal of Things, 2015 - publisher.com"
  const [who = '', where = ''] = clip(raw.byline, 600).split(/\s+-\s+/);
  const year = yearIn(where);
  const venue =
    clip(
      where
        .replace(/,?\s*(1[89]\d\d|20\d\d)\s*$/, '')
        .replace(/^…\s*|\s*…$/g, '')
        .trim(),
      200,
    ) || null;
  const authors = byline(who);
  return {
    key: doi ?? `title:${title.toLowerCase()}`,
    title,
    doi,
    byline: authors,
    year,
    venue,
    reference: referenceLine({ byline: authors, year, title, venue, doi }),
  };
}

/** The papers on the page, each once, in page order. */
export function itemsFrom(listing: RawListing | null | undefined): ListItem[] {
  if (!listing || !Array.isArray(listing.items)) return [];
  const read =
    listing.site === 'pubmed' ? fromPubmed : listing.site === 'arxiv' ? fromArxiv : fromScholar;
  const seen = new Set<string>();
  const items: ListItem[] = [];
  for (const raw of listing.items.slice(0, 100)) {
    const item = read(raw);
    if (!item || seen.has(item.key)) continue;
    seen.add(item.key);
    items.push(item);
  }
  return items;
}
