/**
 * Reference resolution — PRD FR-2.1 and PHASES 2.5.
 *
 *   "Crossref `query.bibliographic` (top 3) → pick by normalised similarity ≥ 0.85 on
 *    title/authors/year; fallback OpenAlex search; store `Source` with `cslJson`, `oaStatus`,
 *    `citationCount`, `isPreprint`, retraction check (Crossref `update-to`); unresolved →
 *    `UNRESOLVED`."
 *
 * The response shapes below were taken from the services' own documented fields; every one is
 * read defensively, because a missing field must downgrade the record, never throw (§0.3 rule 1).
 */

import { normalise, similarity } from '../text.js';
import { type ScholarlyClientOptions, ScholarlyHttp } from './http.js';

export const RESOLUTION_THRESHOLD = 0.85;
export const CROSSREF_CANDIDATES = 3;

/** CSL-JSON author, as `Source.authors` stores it (PRD §8). */
export type CslAuthor = { family?: string; given?: string; literal?: string };

export type ResolvedSource = {
  doi: string | null;
  openalexId: string | null;
  title: string | null;
  authors: CslAuthor[];
  year: number | null;
  venue: string | null;
  /** CSL type: journal-article, book, chapter … */
  type: string | null;
  cslJson: Record<string, unknown> | null;
  oaStatus: string | null;
  citationCount: number | null;
  isPreprint: boolean;
  isRetracted: boolean;
  /** How confident the match is; below RESOLUTION_THRESHOLD the caller stores UNRESOLVED. */
  score: number;
  via: 'crossref' | 'openalex' | null;
};

export const UNRESOLVED: ResolvedSource = {
  doi: null,
  openalexId: null,
  title: null,
  authors: [],
  year: null,
  venue: null,
  type: null,
  cslJson: null,
  oaStatus: null,
  citationCount: null,
  isPreprint: false,
  isRetracted: false,
  score: 0,
  via: null,
};

// ---------------------------------------------------------------------------------------------
// Crossref
// ---------------------------------------------------------------------------------------------

type CrossrefAuthor = { family?: string; given?: string; name?: string };
type CrossrefItem = {
  DOI?: string;
  title?: string[];
  author?: CrossrefAuthor[];
  issued?: { 'date-parts'?: number[][] };
  'container-title'?: string[];
  type?: string;
  subtype?: string;
  'is-referenced-by-count'?: number;
  'update-to'?: Array<{ type?: string; DOI?: string }>;
  relation?: Record<string, unknown>;
};
type CrossrefResponse = { message?: { items?: CrossrefItem[] } };

export class CrossrefClient {
  private readonly http: ScholarlyHttp;

  constructor(options: ScholarlyClientOptions) {
    this.http = new ScholarlyHttp('crossref', options);
  }

  /** Top-N bibliographic search. */
  async searchBibliographic(reference: string, rows = CROSSREF_CANDIDATES, signal?: AbortSignal) {
    const url =
      'https://api.crossref.org/works?rows=' +
      rows +
      '&select=DOI,title,author,issued,container-title,type,subtype,is-referenced-by-count,update-to' +
      '&mailto=' +
      encodeURIComponent(this.http.mailto) +
      '&query.bibliographic=' +
      encodeURIComponent(reference);
    const body = await this.http.getJson<CrossrefResponse>(url, signal);
    return body?.message?.items ?? [];
  }

  async byDoi(doi: string, signal?: AbortSignal): Promise<CrossrefItem | null> {
    const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}?mailto=${encodeURIComponent(this.http.mailto)}`;
    const body = await this.http.getJson<{ message?: CrossrefItem }>(url, signal);
    return body?.message ?? null;
  }
}

function crossrefYear(item: CrossrefItem): number | null {
  const year = item.issued?.['date-parts']?.[0]?.[0];
  return typeof year === 'number' ? year : null;
}

function crossrefAuthors(item: CrossrefItem): CslAuthor[] {
  return (item.author ?? []).map((a) =>
    a.family || a.given
      ? { family: a.family ?? '', given: a.given ?? '' }
      : { literal: a.name ?? '' },
  );
}

/**
 * A Crossref `update-to` entry of type `retraction` means this record retracts another. A record
 * that IS retracted carries `relation.is-retracted-by` or has type `retraction` pointing at it;
 * Crossref models this inconsistently, so both signals are checked and neither is trusted alone.
 */
function crossrefRetracted(item: CrossrefItem): boolean {
  if ((item.type ?? '').toLowerCase() === 'retraction') return true;
  const relation = item.relation ?? {};
  return 'is-retracted-by' in relation || 'is-retracted' in relation;
}

function crossrefPreprint(item: CrossrefItem): boolean {
  return (item.type ?? '') === 'posted-content' || (item.subtype ?? '') === 'preprint';
}

// ---------------------------------------------------------------------------------------------
// OpenAlex
// ---------------------------------------------------------------------------------------------

type OpenAlexWork = {
  id?: string;
  doi?: string;
  title?: string;
  display_name?: string;
  publication_year?: number;
  cited_by_count?: number;
  type?: string;
  authorships?: Array<{ author?: { display_name?: string } }>;
  primary_location?: { source?: { display_name?: string } };
  host_venue?: { display_name?: string };
  open_access?: { oa_status?: string };
};
type OpenAlexResponse = { results?: OpenAlexWork[] };

export class OpenAlexClient {
  private readonly http: ScholarlyHttp;

  constructor(options: ScholarlyClientOptions) {
    this.http = new ScholarlyHttp('openalex', options);
  }

  /** Free-text search. PHASES 2.5 allows this for resolution only, never discovery (Phase 2). */
  async search(reference: string, perPage = 3, signal?: AbortSignal): Promise<OpenAlexWork[]> {
    const url =
      'https://api.openalex.org/works?per-page=' +
      perPage +
      '&mailto=' +
      encodeURIComponent(this.http.mailto) +
      '&search=' +
      encodeURIComponent(reference);
    const body = await this.http.getJson<OpenAlexResponse>(url, signal);
    return body?.results ?? [];
  }

  async byDoi(doi: string, signal?: AbortSignal): Promise<OpenAlexWork | null> {
    const url = `https://api.openalex.org/works/doi:${encodeURIComponent(doi)}?mailto=${encodeURIComponent(this.http.mailto)}`;
    return this.http.getJson<OpenAlexWork>(url, signal);
  }
}

function openAlexAuthors(work: OpenAlexWork): CslAuthor[] {
  return (work.authorships ?? []).map((a) => ({ literal: a.author?.display_name ?? '' }));
}

// ---------------------------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------------------------

/**
 * FR-2.1 similarity: title carries the decision, with author surnames and the year as corroboration.
 * A year that contradicts the reference caps the score below the threshold, because a same-titled
 * paper from another year is a different work.
 */
export function candidateScore(
  reference: string,
  candidate: { title: string | null; authors: CslAuthor[]; year: number | null },
): number {
  const normalisedReference = normalise(reference);
  if (!candidate.title) return 0;

  const titleScore = bestSubstringSimilarity(normalisedReference, normalise(candidate.title));

  const surnames = candidate.authors
    .map((a) => normalise(a.family ?? a.literal ?? ''))
    .flatMap((name) => name.split(' ').filter((part) => part.length > 2))
    .slice(0, 6);
  const authorHits = surnames.filter((name) => normalisedReference.includes(name)).length;
  const authorScore = surnames.length === 0 ? 0 : authorHits / surnames.length;

  const yearInReference = /\b(19|20)\d{2}\b/.exec(normalisedReference)?.[0];
  let yearScore = 0;
  if (candidate.year && yearInReference) {
    yearScore = Number(yearInReference) === candidate.year ? 1 : -1;
  }

  const score = 0.7 * titleScore + 0.2 * authorScore + 0.1 * Math.max(yearScore, 0);
  // A contradicted year cannot clear the bar on title alone.
  return yearScore < 0 ? Math.min(score, RESOLUTION_THRESHOLD - 0.01) : score;
}

/**
 * How well `needle` appears inside `haystack`. A reference string is author + title + venue + year,
 * so comparing it whole against a bare title would score badly however right the match is; this
 * slides a window the length of the title along the reference.
 */
function bestSubstringSimilarity(haystack: string, needle: string): number {
  if (!needle) return 0;
  if (haystack.includes(needle)) return 1;
  if (needle.length >= haystack.length) return similarity(haystack, needle);

  let best = 0;
  const step = Math.max(1, Math.floor(needle.length / 8));
  for (let start = 0; start + needle.length <= haystack.length; start += step) {
    const score = similarity(haystack.slice(start, start + needle.length), needle);
    if (score > best) best = score;
    if (best === 1) break;
  }
  return best;
}

export type Resolver = {
  crossref: CrossrefClient;
  openalex: OpenAlexClient;
};

/**
 * Resolves one raw reference string. Crossref first (its bibliographic search is built for exactly
 * this), OpenAlex as the fallback. Returns `UNRESOLVED` when nothing clears the threshold — never
 * a guess, because a wrong DOI is worse than none (FR-2.1: unresolved strings are kept for manual
 * fix).
 */
export async function resolveReference(
  reference: string,
  resolver: Resolver,
  signal?: AbortSignal,
): Promise<ResolvedSource> {
  const items = await resolver.crossref.searchBibliographic(reference, CROSSREF_CANDIDATES, signal);

  let best: ResolvedSource = { ...UNRESOLVED };
  for (const item of items) {
    const candidate = {
      title: item.title?.[0] ?? null,
      authors: crossrefAuthors(item),
      year: crossrefYear(item),
    };
    const score = candidateScore(reference, candidate);
    if (score <= best.score) continue;
    best = {
      doi: item.DOI ? item.DOI.toLowerCase() : null,
      openalexId: null,
      title: candidate.title,
      authors: candidate.authors,
      year: candidate.year,
      venue: item['container-title']?.[0] ?? null,
      type: item.type ?? null,
      cslJson: item as Record<string, unknown>,
      oaStatus: null,
      citationCount: item['is-referenced-by-count'] ?? null,
      isPreprint: crossrefPreprint(item),
      isRetracted: crossrefRetracted(item),
      score,
      via: 'crossref',
    };
  }

  if (best.score >= RESOLUTION_THRESHOLD) {
    // Enrich with OpenAlex for oaStatus and a citation count, but never let that failure lose the
    // Crossref match.
    if (best.doi) {
      try {
        const work = await resolver.openalex.byDoi(best.doi, signal);
        if (work) {
          best.openalexId = work.id ?? null;
          best.oaStatus = work.open_access?.oa_status ?? null;
          best.citationCount = work.cited_by_count ?? best.citationCount;
        }
      } catch {
        // Metadata enrichment is best-effort.
      }
    }
    return best;
  }

  // Crossref did not settle it: try OpenAlex search.
  const works = await resolver.openalex.search(reference, 3, signal);
  for (const work of works) {
    const candidate = {
      title: work.title ?? work.display_name ?? null,
      authors: openAlexAuthors(work),
      year: work.publication_year ?? null,
    };
    const score = candidateScore(reference, candidate);
    if (score <= best.score) continue;
    best = {
      doi: work.doi ? work.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, '').toLowerCase() : null,
      openalexId: work.id ?? null,
      title: candidate.title,
      authors: candidate.authors,
      year: candidate.year,
      venue: work.primary_location?.source?.display_name ?? work.host_venue?.display_name ?? null,
      type: work.type ?? null,
      cslJson: null,
      oaStatus: work.open_access?.oa_status ?? null,
      citationCount: work.cited_by_count ?? null,
      isPreprint: (work.type ?? '') === 'preprint',
      isRetracted: false,
      score,
      via: 'openalex',
    };
  }

  return best.score >= RESOLUTION_THRESHOLD ? best : { ...UNRESOLVED };
}

// ---------------------------------------------------------------------------------------------
// Unpaywall (FR-2.2)
// ---------------------------------------------------------------------------------------------

type UnpaywallResponse = {
  is_oa?: boolean;
  oa_status?: string;
  best_oa_location?: { url_for_pdf?: string; url?: string; host_type?: string; version?: string };
};

export type OpenAccessLocation = {
  pdfUrl: string | null;
  landingUrl: string | null;
  oaStatus: string | null;
  isOa: boolean;
};

export class UnpaywallClient {
  private readonly http: ScholarlyHttp;

  constructor(options: ScholarlyClientOptions) {
    this.http = new ScholarlyHttp('unpaywall', options);
  }

  /** FR-2.2: `best_oa_location` → PDF for full-text grounding. */
  async bestOpenAccess(doi: string, signal?: AbortSignal): Promise<OpenAccessLocation | null> {
    const url = `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(this.http.mailto)}`;
    const body = await this.http.getJson<UnpaywallResponse>(url, signal);
    if (!body) return null;
    return {
      pdfUrl: body.best_oa_location?.url_for_pdf ?? null,
      landingUrl: body.best_oa_location?.url ?? null,
      oaStatus: body.oa_status ?? null,
      isOa: body.is_oa === true,
    };
  }
}

/** FR-2.2: full text when a PDF was fetched, abstract-only otherwise. */
export function groundingLevelFor(
  hasFullText: boolean,
  hasAbstract: boolean,
): 'NONE' | 'ABSTRACT' | 'FULL_TEXT' {
  if (hasFullText) return 'FULL_TEXT';
  return hasAbstract ? 'ABSTRACT' : 'NONE';
}
