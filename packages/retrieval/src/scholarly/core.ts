/**
 * CORE full-text fallback — PRD FR-2.2.
 *
 *   "For OA sources, full text is fetched (Unpaywall `best_oa_location` → PDF; fallback CORE)"
 *
 * CORE (core.ac.uk) aggregates the full text of open-access papers from institutional repositories,
 * so it often has a PDF for a paper Unpaywall lists with no `url_for_pdf`. It is only asked after
 * Unpaywall has failed, and only when `CORE_API_KEY` is set (optional, PRD §13.3).
 *
 * §0.3 rule 1 — nothing here is guessed. CORE's documentation site refuses non-browser clients, so
 * the contract below was read from the API itself on 2026-09-07:
 *
 *   GET https://api.core.ac.uk/v3/search/works?q=doi:"10.1038/nature12373"&limit=1
 *   → {"totalHits":3,"limit":1,"offset":0,"results":[{"id":72404683,"doi":"10.1038/nature12373",
 *      "title":"Nanometre-scale thermometry in a living cell","downloadUrl":"",
 *      "sourceFulltextUrls":[],"links":[{"type":"display","url":"https://core.ac.uk/works/72404683"}],
 *      …}],"searchId":"…"}
 *
 *   GET …/v3/search/works?q=doi:"10.1371/journal.pone.0185809"&limit=1
 *   → results[0]: {"id":8020617,"doi":"10.1371/journal.pone.0185809",
 *      "downloadUrl":"https://core.ac.uk/download/132289095.pdf",
 *      "sourceFulltextUrls":["https://core.ac.uk/download/132289095.pdf",
 *      "http://europepmc.org/articles/PMC5646769?pdf=render",
 *      "https://repository.ubn.ru.nl//bitstream/handle/2066/179056/179056.pdf"],…}
 *
 *   The same request with `Authorization: Bearer not-a-real-key`
 *   → 401 {"message":"The API key you provided is not valid."}
 *
 * Only the fields quoted above are read. `downloadUrl` is CORE's own copy of the PDF and is an
 * empty string when it has none; `sourceFulltextUrls` lists the repository's copies. Whatever URL
 * comes back is still put through `fetchOpenAccessPdf`, which checks it really is a PDF.
 */

import { type ScholarlyClientOptions, ScholarlyHttp } from './http.js';

/** Works the search returns before the DOI is matched exactly; the search itself is fuzzy. */
export const CORE_SEARCH_LIMIT = 5;

/**
 * Requests per second when the caller does not say. CORE's published limits could not be read
 * from here (see the header); one per second is well under any keyed tier and the fallback is
 * rarely reached, so it costs nothing in practice.
 */
export const CORE_REQUESTS_PER_SECOND = 1;

type CoreWork = {
  id?: number;
  doi?: string | null;
  title?: string | null;
  downloadUrl?: string | null;
  sourceFulltextUrls?: string[] | null;
};

type CoreSearchResponse = {
  totalHits?: number;
  results?: CoreWork[];
};

export type CoreFullText = {
  pdfUrl: string;
  coreId: number | null;
  title: string | null;
  /** Which field the URL came from, so the log says what was actually used. */
  via: 'downloadUrl' | 'sourceFulltextUrls';
};

/** `10.1038/NATURE12373`, `https://doi.org/10.1038/nature12373` → `10.1038/nature12373`. */
function normaliseDoi(doi: string | null | undefined): string | null {
  if (!doi) return null;
  const bare = doi
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:/i, '')
    .toLowerCase();
  return bare.length > 0 ? bare : null;
}

export class CoreClient {
  private readonly http: ScholarlyHttp;

  constructor(apiKey: string, options: ScholarlyClientOptions) {
    // Same shape as `SemanticScholarClient`: the key rides on every request the shared client makes.
    this.http = new ScholarlyHttp('core', {
      ...options,
      requestsPerSecond: options.requestsPerSecond ?? CORE_REQUESTS_PER_SECOND,
      fetch: (url, init) =>
        (options.fetch ?? fetch)(url, {
          ...init,
          headers: {
            ...(init?.headers as Record<string, string>),
            authorization: `Bearer ${apiKey}`,
          },
        }),
    });
  }

  /**
   * A URL for the full text of the work with this DOI, or null when CORE has none.
   *
   * The search is matched back against the DOI exactly: `q=doi:"…"` is a search, not a lookup,
   * and a near-miss would ground one paper's claims in another's text.
   */
  async fullTextUrl(doi: string, signal?: AbortSignal): Promise<CoreFullText | null> {
    const wanted = normaliseDoi(doi);
    if (!wanted) return null;

    const query = encodeURIComponent(`doi:"${wanted}"`);
    const url = `https://api.core.ac.uk/v3/search/works?q=${query}&limit=${CORE_SEARCH_LIMIT}`;
    const body = await this.http.getJson<CoreSearchResponse>(url, signal);

    for (const work of body?.results ?? []) {
      if (normaliseDoi(work.doi) !== wanted) continue;
      const coreId = typeof work.id === 'number' ? work.id : null;
      const title = typeof work.title === 'string' && work.title.trim() ? work.title.trim() : null;

      const download = typeof work.downloadUrl === 'string' ? work.downloadUrl.trim() : '';
      if (download) return { pdfUrl: download, coreId, title, via: 'downloadUrl' };

      const repository = (work.sourceFulltextUrls ?? []).find(
        (candidate) => typeof candidate === 'string' && candidate.trim().length > 0,
      );
      if (repository) {
        return { pdfUrl: repository.trim(), coreId, title, via: 'sourceFulltextUrls' };
      }
    }
    return null;
  }
}
