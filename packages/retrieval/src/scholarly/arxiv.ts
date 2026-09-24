/**
 * arXiv — ADR-0020. Search, and look one e-print up by its id.
 *
 * What arXiv adds over OpenAlex is time: an e-print is searchable here the day it is announced,
 * and OpenAlex picks it up days or weeks later. It is also the one index that holds every
 * preprint in the fields the pilot starts with (engineering, computer science).
 *
 * The terms (info.arxiv.org/help/api/tou.html), which shape this file:
 *
 * - **One request every three seconds, one connection at a time, across all our machines.** The
 *   apps pass a `sharedGate` over Redis; the in-process default below is only for scripts and tests.
 * - **Metadata is CC0**, so titles and abstracts may be stored — which is all this reads.
 * - **E-prints may not be stored and served from our servers** unless their licence allows it.
 *   Nothing here downloads a PDF, and an arXiv-only source is grounded on its abstract. The
 *   student can upload the PDF themselves, and the library links to the abstract page, as arXiv
 *   asks.
 */

import { arxivDoi, arxivIdFromUrl } from './arxiv-id.js';
import { DISCOVER, type DiscoveredWork } from './discover.js';
import { type ScholarlyClientOptions, ScholarlyHttp } from './http.js';
import { keywordsOf } from './keywords.js';
import { attribute, elements, firstInner, plainText } from './xml.js';

export const ARXIV = {
  /** Results per query. Ten, not OpenAlex's 25: every candidate costs an embedding in the run. */
  perQuery: 10,
  /** The terms' "no more than one request every three seconds". */
  intervalMs: 3_000,
  api: 'https://export.arxiv.org/api/query',
} as const;

/** One e-print, as the Atom feed describes it. */
export type ArxivEntry = {
  /** Without the version: `2410.08098`, or `hep-th/9901001` for the old scheme. */
  id: string;
  title: string;
  abstract: string | null;
  authors: string[];
  /** First version's date, ISO. */
  published: string | null;
  year: number | null;
  /** The journal DOI the authors added once it was published, if they did. */
  doi: string | null;
  journalRef: string | null;
  categories: string[];
  /** The latest version withdraws the paper. It stays listed, and is not worth offering. */
  withdrawn: boolean;
};

export function parseArxivFeed(xml: string): ArxivEntry[] {
  const out: ArxivEntry[] = [];
  for (const { inner } of elements(xml, 'entry')) {
    const id = arxivIdFromUrl(plainText(firstInner(inner, 'id')));
    const title = plainText(firstInner(inner, 'title'));
    // The feed answers an unknown id with an entry titled "Error"; it has no arXiv id.
    if (!id || !title) continue;
    const published = plainText(firstInner(inner, 'published')) || null;
    const year = published ? Number.parseInt(published.slice(0, 4), 10) : Number.NaN;
    const comment = plainText(firstInner(inner, 'arxiv:comment'));
    out.push({
      id,
      title,
      abstract: plainText(firstInner(inner, 'summary')) || null,
      authors: elements(inner, 'author')
        .map((author) => plainText(firstInner(author.inner, 'name')))
        .filter(Boolean),
      published,
      year: Number.isFinite(year) ? year : null,
      doi: plainText(firstInner(inner, 'arxiv:doi')).toLowerCase() || null,
      journalRef: plainText(firstInner(inner, 'arxiv:journal_ref')) || null,
      // `<category term="cs.CV" …/>` is self-closing, so it is read from the tag, not a block.
      categories: [...inner.matchAll(/<category\s[^>]*\/?>/g)]
        .map((m) => attribute(m[0].replace(/\/?>$/, ''), 'term'))
        .filter((t): t is string => Boolean(t)),
      withdrawn: /\bwithdrawn\b/i.test(comment),
    });
  }
  return out;
}

/**
 * An e-print as a search result. With a journal DOI it is the published paper — merged with
 * OpenAlex's record of it when both found it — and without one it is the preprint itself.
 */
export function workFromArxiv(entry: ArxivEntry): DiscoveredWork {
  return {
    openalexId: null,
    doi: entry.doi ?? arxivDoi(entry.id),
    title: entry.title,
    abstract: entry.abstract,
    year: entry.year,
    venue: entry.doi ? null : 'arXiv',
    citationCount: null,
    isPreprint: entry.doi === null,
    // Every e-print is free to read on arXiv, whatever its licence says about redistribution.
    oaStatus: 'green',
    via: 'arxiv',
  };
}

/** `all:rooftop AND all:solar AND all:adoption` — every content word must appear. */
export function arxivSearchQuery(keywords: readonly string[]): string {
  return keywords.map((word) => `all:${word}`).join(' AND ');
}

export class ArxivClient {
  private readonly http: ScholarlyHttp;

  constructor(options: ScholarlyClientOptions) {
    this.http = new ScholarlyHttp('arxiv', {
      ...options,
      requestsPerSecond: options.requestsPerSecond ?? 1000 / ARXIV.intervalMs,
    });
  }

  /**
   * Up to ten recent e-prints for a query, most relevant first. Four content words at most:
   * every word must appear, and a fifth rarely narrows the result usefully before emptying it.
   */
  async search(query: string, now = new Date(), signal?: AbortSignal): Promise<DiscoveredWork[]> {
    const words = keywordsOf(query, 4);
    if (words.length === 0) return [];
    const url =
      `${ARXIV.api}?search_query=${encodeURIComponent(arxivSearchQuery(words))}` +
      `&start=0&max_results=${ARXIV.perQuery}&sortBy=relevance&sortOrder=descending`;
    const xml = await this.http.getText(url, 'application/atom+xml', signal);
    const from = now.getUTCFullYear() - DISCOVER.yearsBack;
    return parseArxivFeed(xml ?? '')
      .filter((entry) => !entry.withdrawn && (entry.year === null || entry.year >= from))
      .map(workFromArxiv);
  }

  /** One e-print by id — the resolver's fallback when OpenAlex has not indexed it yet. */
  async byId(id: string, signal?: AbortSignal): Promise<ArxivEntry | null> {
    const xml = await this.http.getText(
      `${ARXIV.api}?id_list=${encodeURIComponent(id)}&max_results=1`,
      'application/atom+xml',
      signal,
    );
    return parseArxivFeed(xml ?? '')[0] ?? null;
  }
}
