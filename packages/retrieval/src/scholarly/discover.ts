/**
 * Literature discovery — PRD FR-2.5, FR-2.8, PHASES v2 W7.1 and W7.4.
 *
 * OpenAlex is the primary index (no key, polite pool via `mailto`); Semantic Scholar is secondary
 * when a key is configured. Results are merged by DOI, then by normalised title, so one paper
 * appearing in both indexes is one candidate. Nothing here ranks by relevance — that is the
 * embedding filter in the job (FR-2.5: "no strong-tier call in the filter").
 */

import { type ScholarlyClientOptions, ScholarlyHttp } from './http.js';
import { openAlexSearchText } from './keywords.js';
import { abstractFromInvertedIndex } from './resolve.js';
import { plainText } from './xml.js';

/** One paper as a search result, before it is a `SearchCandidate` row. */
export type DiscoveredWork = {
  openalexId: string | null;
  doi: string | null;
  title: string;
  abstract: string | null;
  year: number | null;
  venue: string | null;
  citationCount: number | null;
  isPreprint: boolean;
  oaStatus: string | null;
  /** Which index found it; kept for the per-stage log. */
  via: 'openalex' | 'semanticscholar' | 'arxiv' | 'pubmed';
};

export const DISCOVER = {
  /** FR-2.5 / PHASES: "year ≥ current−15". */
  yearsBack: 15,
  perQuery: 25,
  /** FR-2.8: "`cited_by` (top 10)". */
  citedByTop: 10,
  /**
   * ADR-0050: every kind of work a thesis cites. The list was article, preprint and book-chapter
   * only, which silently removed conference papers (most of computer science and much of
   * engineering — ResNet is a `conference-paper`), review articles (the best start for a
   * literature review), dissertations and books. Reports and standards stay out: they are mostly
   * grey literature a discipline should opt into.
   */
  types: 'article|review|conference-paper|preprint|book-chapter|book|dissertation',
  /** OpenAlex's semantic search returns at most 50 and allows one request a second. */
  semanticTop: 50,
} as const;

type OpenAlexWork = {
  id?: string;
  doi?: string;
  title?: string;
  display_name?: string;
  publication_year?: number;
  cited_by_count?: number;
  type?: string;
  primary_location?: { source?: { display_name?: string } };
  open_access?: { oa_status?: string };
  abstract_inverted_index?: Record<string, number[]>;
  related_works?: string[];
};
type OpenAlexList = { results?: OpenAlexWork[]; meta?: { count?: number } };

const SELECT =
  'id,doi,title,display_name,publication_year,cited_by_count,type,primary_location,open_access,abstract_inverted_index,related_works';

export const normaliseDoi = (doi: string | null | undefined): string | null => {
  if (!doi) return null;
  const d = doi
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .toLowerCase();
  return d.startsWith('10.') ? d : null;
};

export const normaliseTitle = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** The bare id ("W123") from an OpenAlex URL id. */
export const openalexShortId = (id: string | null | undefined): string | null => {
  if (!id) return null;
  const m = /W\d+$/.exec(id);
  return m ? m[0] : null;
};

function fromOpenAlex(work: OpenAlexWork): DiscoveredWork | null {
  const title = plainText(work.title ?? work.display_name);
  if (!title) return null;
  return {
    openalexId: openalexShortId(work.id),
    doi: normaliseDoi(work.doi),
    title,
    abstract: abstractFromInvertedIndex(work.abstract_inverted_index) || null,
    year: work.publication_year ?? null,
    venue: plainText(work.primary_location?.source?.display_name) || null,
    citationCount: work.cited_by_count ?? null,
    isPreprint: work.type === 'preprint',
    oaStatus: work.open_access?.oa_status ?? null,
    via: 'openalex',
  };
}

export class OpenAlexDiscovery {
  private readonly http: ScholarlyHttp;

  constructor(options: ScholarlyClientOptions) {
    this.http = new ScholarlyHttp('openalex', options);
  }

  private base(extra: string, perPage: number): string {
    return (
      `https://api.openalex.org/works?per-page=${perPage}&select=${SELECT}` +
      `&mailto=${encodeURIComponent(this.http.mailto)}&${extra}`
    );
  }

  /** FR-2.5: one keyword query → up to 25 recent works of the kinds a thesis cites. */
  async search(query: string, now = new Date(), signal?: AbortSignal): Promise<DiscoveredWork[]> {
    const from = now.getUTCFullYear() - DISCOVER.yearsBack;
    // `is_retracted:false` (ADR-0050): OpenAlex carries Retraction Watch's list; a retracted paper
    // is never worth offering as a candidate.
    const filter = encodeURIComponent(
      `type:${DISCOVER.types},from_publication_date:${from}-01-01,is_retracted:false`,
    );
    const url = this.base(
      `filter=${filter}&search=${encodeURIComponent(openAlexSearchText(query))}`,
      DISCOVER.perQuery,
    );
    const body = await this.http.getJson<OpenAlexList>(url, signal);
    return (body?.results ?? []).map(fromOpenAlex).filter((w): w is DiscoveredWork => w !== null);
  }

  /**
   * ADR-0046: how many works OpenAlex holds for a query, per publication year, over the same
   * window and types `search` uses. One request — `group_by` returns the counts without the
   * works — so a theme's density costs a single call.
   */
  async yearCounts(
    query: string,
    now = new Date(),
    signal?: AbortSignal,
  ): Promise<Array<{ year: number; count: number }>> {
    const from = now.getUTCFullYear() - DISCOVER.yearsBack;
    // Title and abstract, not `search=`: the plain search also matches full text, so a paper that
    // mentions "marine" once in its methods counted towards a marine theme (2026-10-03, the first
    // local run read 57,696 papers for "solar drying marine"). A comma would end the filter
    // value, so none is let through.
    const terms = openAlexSearchText(query).replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
    const filter = encodeURIComponent(
      `title_and_abstract.search:${terms},type:${DISCOVER.types},from_publication_date:${from}-01-01`,
    );
    const url =
      `https://api.openalex.org/works?filter=${filter}` +
      `&group_by=publication_year&mailto=${encodeURIComponent(this.http.mailto)}`;
    const body = await this.http.getJson<{
      group_by?: Array<{ key?: string | number; count?: number }>;
    }>(url, signal);
    return (body?.group_by ?? []).flatMap((g) => {
      const year = Number(g.key);
      return Number.isInteger(year) && typeof g.count === 'number'
        ? [{ year, count: g.count }]
        : [];
    });
  }

  /**
   * ADR-0050: OpenAlex's semantic search — the thesis scope as a paragraph, matched by meaning
   * against the embedded titles and abstracts of the whole index (up to 2,000 characters in, 50
   * works out). Keyword queries find papers that share our words; this finds the ones that share
   * the idea. Measured 2026-10-04 on "barriers to rooftop solar PV adoption among Indian
   * households": semantic search's top results were household-adoption studies in Kerala and
   * Pakistan, the keyword search's were pilots in South Africa. Same price as `search=`.
   *
   * Semantic search accepts `publication_year` but not `from_publication_date`, and cannot be
   * sorted; relevance is its order.
   */
  async semanticSearch(
    text: string,
    now = new Date(),
    signal?: AbortSignal,
  ): Promise<DiscoveredWork[]> {
    const from = now.getUTCFullYear() - DISCOVER.yearsBack;
    const filter = encodeURIComponent(
      `publication_year:>${from - 1},type:${DISCOVER.types},has_abstract:true,is_retracted:false`,
    );
    const q = openAlexSearchText(text).slice(0, 2_000);
    const url =
      `https://api.openalex.org/works?per-page=${DISCOVER.semanticTop}&select=${SELECT}` +
      `&mailto=${encodeURIComponent(this.http.mailto)}&filter=${filter}` +
      `&search.semantic=${encodeURIComponent(q)}`;
    const body = await this.http.getJson<OpenAlexList>(url, signal);
    return (body?.results ?? []).map(fromOpenAlex).filter((w): w is DiscoveredWork => w !== null);
  }

  /** FR-2.8: the works that cite this one, most cited first. */
  async citedBy(openalexId: string, signal?: AbortSignal): Promise<DiscoveredWork[]> {
    const filter = encodeURIComponent(
      `cites:${openalexId},type:${DISCOVER.types},is_retracted:false`,
    );
    const url = this.base(`filter=${filter}&sort=cited_by_count:desc`, DISCOVER.citedByTop);
    const body = await this.http.getJson<OpenAlexList>(url, signal);
    return (body?.results ?? []).map(fromOpenAlex).filter((w): w is DiscoveredWork => w !== null);
  }

  /** FR-2.8: OpenAlex's own `related_works` for this work, fetched in one call. */
  async related(openalexId: string, signal?: AbortSignal): Promise<DiscoveredWork[]> {
    const work = await this.http.getJson<OpenAlexWork>(
      `https://api.openalex.org/works/${openalexId}?select=id,related_works&mailto=${encodeURIComponent(this.http.mailto)}`,
      signal,
    );
    const ids = (work?.related_works ?? [])
      .map(openalexShortId)
      .filter((id): id is string => id !== null)
      .slice(0, DISCOVER.citedByTop);
    if (ids.length === 0) return [];
    const filter = encodeURIComponent(`openalex_id:${ids.join('|')}`);
    const body = await this.http.getJson<OpenAlexList>(
      this.base(`filter=${filter}`, ids.length),
      signal,
    );
    return (body?.results ?? []).map(fromOpenAlex).filter((w): w is DiscoveredWork => w !== null);
  }
}

type S2Paper = {
  paperId?: string;
  externalIds?: { DOI?: string };
  title?: string;
  abstract?: string | null;
  year?: number | null;
  venue?: string | null;
  citationCount?: number | null;
  publicationTypes?: string[] | null;
  isOpenAccess?: boolean;
};

/** Semantic Scholar, secondary and optional (`SEMANTIC_SCHOLAR_API_KEY`, PRD §13.3). */
export class SemanticScholarClient {
  private readonly http: ScholarlyHttp;

  constructor(
    private readonly apiKey: string,
    options: ScholarlyClientOptions,
  ) {
    this.http = new ScholarlyHttp('semanticscholar', {
      ...options,
      requestsPerSecond: options.requestsPerSecond ?? 1,
      fetch: (url, init) =>
        (options.fetch ?? fetch)(url, {
          ...init,
          headers: { ...(init?.headers as Record<string, string>), 'x-api-key': this.apiKey },
        }),
    });
  }

  async search(query: string, now = new Date(), signal?: AbortSignal): Promise<DiscoveredWork[]> {
    const from = now.getUTCFullYear() - DISCOVER.yearsBack;
    const url =
      'https://api.semanticscholar.org/graph/v1/paper/search?limit=' +
      DISCOVER.perQuery +
      `&year=${from}-&fields=externalIds,title,abstract,year,venue,citationCount,publicationTypes,isOpenAccess` +
      `&query=${encodeURIComponent(query)}`;
    const body = await this.http.getJson<{ data?: S2Paper[] }>(url, signal);
    return (body?.data ?? [])
      .map((p): DiscoveredWork | null => {
        const title = plainText(p.title);
        if (!title) return null;
        return {
          openalexId: null,
          doi: normaliseDoi(p.externalIds?.DOI),
          title,
          abstract: p.abstract ?? null,
          year: p.year ?? null,
          venue: p.venue ?? null,
          citationCount: p.citationCount ?? null,
          isPreprint: false,
          oaStatus: p.isOpenAccess ? 'open' : null,
          via: 'semanticscholar',
        };
      })
      .filter((w): w is DiscoveredWork => w !== null);
  }
}

/**
 * Takes from each list in turn — first of each, then second of each — so that when only a few
 * results are shown, every index that answered is in them. Concatenating would let the first
 * index fill the page by itself.
 */
export function interleave<T>(lists: ReadonlyArray<readonly T[]>): T[] {
  const out: T[] = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let i = 0; i < longest; i++) {
    for (const list of lists) {
      const item = list[i];
      if (item !== undefined) out.push(item);
    }
  }
  return out;
}

/**
 * FR-2.5: "merged and de-duplicated by DOI/title". The first occurrence wins; a later duplicate
 * only fills fields the first lacked (an abstract from the other index, an OpenAlex id).
 */
export function mergeWorks(lists: ReadonlyArray<readonly DiscoveredWork[]>): DiscoveredWork[] {
  const byKey = new Map<string, DiscoveredWork>();
  const order: string[] = [];
  for (const list of lists) {
    for (const work of list) {
      const key = work.doi ? `doi:${work.doi}` : `title:${normaliseTitle(work.title)}`;
      const altKey = work.doi ? `title:${normaliseTitle(work.title)}` : null;
      const existing = byKey.get(key) ?? (altKey ? byKey.get(altKey) : undefined);
      if (!existing) {
        byKey.set(key, { ...work });
        if (altKey) byKey.set(altKey, byKey.get(key) as DiscoveredWork);
        order.push(key);
        continue;
      }
      existing.abstract = existing.abstract ?? work.abstract;
      existing.openalexId = existing.openalexId ?? work.openalexId;
      existing.doi = existing.doi ?? work.doi;
      existing.venue = existing.venue ?? work.venue;
      existing.citationCount = existing.citationCount ?? work.citationCount;
      existing.year = existing.year ?? work.year;
    }
  }
  return order.map((key) => byKey.get(key) as DiscoveredWork);
}

/** Cosine similarity, for the embedding relevance filter (FR-2.5). */
export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length && i < b.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}
