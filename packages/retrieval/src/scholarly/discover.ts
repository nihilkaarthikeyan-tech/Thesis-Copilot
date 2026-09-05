/**
 * Literature discovery — PRD FR-2.5, FR-2.8, PHASES v2 W7.1 and W7.4.
 *
 * OpenAlex is the primary index (no key, polite pool via `mailto`); Semantic Scholar is secondary
 * when a key is configured. Results are merged by DOI, then by normalised title, so one paper
 * appearing in both indexes is one candidate. Nothing here ranks by relevance — that is the
 * embedding filter in the job (FR-2.5: "no strong-tier call in the filter").
 */

import { type ScholarlyClientOptions, ScholarlyHttp } from './http.js';
import { abstractFromInvertedIndex } from './resolve.js';

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
  via: 'openalex' | 'semanticscholar';
};

export const DISCOVER = {
  /** FR-2.5 / PHASES: "year ≥ current−15". */
  yearsBack: 15,
  perQuery: 25,
  /** FR-2.8: "`cited_by` (top 10)". */
  citedByTop: 10,
  types: 'article|preprint|book-chapter',
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
  const title = (work.title ?? work.display_name ?? '').trim();
  if (!title) return null;
  return {
    openalexId: openalexShortId(work.id),
    doi: normaliseDoi(work.doi),
    title,
    abstract: abstractFromInvertedIndex(work.abstract_inverted_index) || null,
    year: work.publication_year ?? null,
    venue: work.primary_location?.source?.display_name ?? null,
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

  /** FR-2.5: one keyword query → up to 25 recent articles, preprints and chapters. */
  async search(query: string, now = new Date(), signal?: AbortSignal): Promise<DiscoveredWork[]> {
    const from = now.getUTCFullYear() - DISCOVER.yearsBack;
    const filter = encodeURIComponent(`type:${DISCOVER.types},from_publication_date:${from}-01-01`);
    const url = this.base(
      `filter=${filter}&search=${encodeURIComponent(query)}`,
      DISCOVER.perQuery,
    );
    const body = await this.http.getJson<OpenAlexList>(url, signal);
    return (body?.results ?? []).map(fromOpenAlex).filter((w): w is DiscoveredWork => w !== null);
  }

  /** FR-2.8: the works that cite this one, most cited first. */
  async citedBy(openalexId: string, signal?: AbortSignal): Promise<DiscoveredWork[]> {
    const filter = encodeURIComponent(`cites:${openalexId},type:${DISCOVER.types}`);
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
        const title = (p.title ?? '').trim();
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
