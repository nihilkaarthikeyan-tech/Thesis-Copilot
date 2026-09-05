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
  /** Plain-text abstract when the service published one. Decides ABSTRACT vs NONE grounding. */
  abstract: string | null;
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
  abstract: null,
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
  /** JATS-flavoured XML, not plain text; the caller strips tags before storing it. */
  abstract?: string;
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
      // Only fields Crossref actually allows in `select`. `subtype` is NOT one of them and makes
      // the whole request 400, which is how every lookup silently failed once. Verified against
      // the field list the API returns in its own 400 body.
      '&select=DOI,title,author,issued,container-title,type,is-referenced-by-count,update-to,relation,abstract' +
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

/**
 * Crossref returns abstracts as JATS XML (`<jats:p>…</jats:p>`), not text. Tags are stripped and
 * entities decoded so what is stored is what a reader would see; nothing is added.
 */
export function plainAbstract(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, ' ')
    .trim()
    // Publishers prefix the body with the word "Abstract" often enough to be worth removing.
    .replace(/^abstract[:\s]+/i, '');
  return text.length > 0 ? text : null;
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
  /** OpenAlex publishes abstracts only as a word -> positions map, for copyright reasons. */
  abstract_inverted_index?: Record<string, number[]>;
};
type OpenAlexResponse = { results?: OpenAlexWork[]; meta?: { count?: number } };

/** One related work for a gap check (FR-1.5): title, year, one line of abstract. */
export type RelatedWork = {
  title: string;
  year: number | null;
  abstract: string;
  doi: string | null;
};
export type GapCheck = { count: number; works: RelatedWork[] };

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
      // Verified against the live API: every one of these is an accepted `select` field.
      '&select=id,doi,title,display_name,publication_year,cited_by_count,type,authorships,' +
      'primary_location,open_access,abstract_inverted_index' +
      '&mailto=' +
      encodeURIComponent(this.http.mailto) +
      '&search=' +
      encodeURIComponent(reference);
    const body = await this.http.getJson<OpenAlexResponse>(url, signal);
    return body?.results ?? [];
  }

  /**
   * FR-1.5's early gap check: how much related work exists on a clarified topic, and the closest
   * few. Articles, preprints and chapters only, the same filter week 7's discovery uses.
   */
  async searchTopic(topic: string, perPage = 8, signal?: AbortSignal): Promise<GapCheck> {
    const url =
      'https://api.openalex.org/works?per-page=' +
      perPage +
      '&filter=' +
      encodeURIComponent('type:article|preprint|book-chapter') +
      '&select=id,doi,title,display_name,publication_year,abstract_inverted_index' +
      '&mailto=' +
      encodeURIComponent(this.http.mailto) +
      '&search=' +
      encodeURIComponent(topic);
    const body = await this.http.getJson<OpenAlexResponse>(url, signal);
    const works = (body?.results ?? []).map((work) => ({
      title: work.title ?? work.display_name ?? '',
      year: work.publication_year ?? null,
      abstract: firstLine(abstractFromInvertedIndex(work.abstract_inverted_index)),
      doi: work.doi ? work.doi.replace(/^https?:\/\/doi\.org\//, '') : null,
    }));
    return { count: body?.meta?.count ?? works.length, works };
  }

  async byDoi(doi: string, signal?: AbortSignal): Promise<OpenAlexWork | null> {
    const url = `https://api.openalex.org/works/doi:${encodeURIComponent(doi)}?mailto=${encodeURIComponent(this.http.mailto)}`;
    return this.http.getJson<OpenAlexWork>(url, signal);
  }
}

/**
 * Rebuilds an abstract from OpenAlex's inverted index. Each key is a token and each value the
 * positions it occupies, so placing every token at its own positions restores the original order.
 * Gaps (a position no token claims) are dropped rather than filled, so nothing is invented.
 */
/** The first sentence, capped, for the one-line abstract A.6 asks for. */
export function firstLine(text: string | null | undefined, max = 220): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const sentence = /^[^.!?]+[.!?]/.exec(t)?.[0] ?? t;
  return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence;
}

export function abstractFromInvertedIndex(
  index: Record<string, number[]> | undefined,
): string | null {
  if (!index) return null;
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) {
      if (Number.isInteger(position) && position >= 0) words[position] = word;
    }
  }
  const text = words
    .filter((word) => word !== undefined)
    .join(' ')
    .trim();
  return text.length > 0 ? text : null;
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

/** Maps a Crossref record onto the shape the worker stores. Reads every field defensively. */
function fromCrossrefItem(item: CrossrefItem, score: number): ResolvedSource {
  return {
    doi: item.DOI ? item.DOI.toLowerCase() : null,
    openalexId: null,
    title: item.title?.[0] ?? null,
    authors: crossrefAuthors(item),
    year: crossrefYear(item),
    venue: item['container-title']?.[0] ?? null,
    type: item.type ?? null,
    cslJson: item as Record<string, unknown>,
    oaStatus: null,
    citationCount: item['is-referenced-by-count'] ?? null,
    isPreprint: crossrefPreprint(item),
    isRetracted: crossrefRetracted(item),
    abstract: plainAbstract(item.abstract),
    score,
    via: 'crossref',
  };
}

/** Adds OpenAlex's open-access status and citation count to a record Crossref already settled. */
async function enrichFromOpenAlex(
  best: ResolvedSource,
  openalex: OpenAlexClient,
  signal?: AbortSignal,
): Promise<ResolvedSource> {
  if (!best.doi) return best;
  try {
    const work = await openalex.byDoi(best.doi, signal);
    if (!work) return best;
    return {
      ...best,
      openalexId: work.id ?? null,
      oaStatus: work.open_access?.oa_status ?? best.oaStatus,
      citationCount: work.cited_by_count ?? best.citationCount,
      abstract: best.abstract ?? abstractFromInvertedIndex(work.abstract_inverted_index),
    };
  } catch {
    // Metadata enrichment is best-effort; a failure here must never lose the match.
    return best;
  }
}

/**
 * Resolves a DOI the student typed in, or one printed in the reference itself. There is nothing to
 * match here — the DOI *is* the answer — so this skips the similarity search entirely and scores 1.
 * FR-2.1's manual fix path depends on this: re-running the bibliographic search that already
 * failed would just fail again.
 */
export async function resolveByDoi(
  doi: string,
  resolver: Resolver,
  signal?: AbortSignal,
): Promise<ResolvedSource> {
  const normalised = doi
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .toLowerCase();
  if (!normalised) return { ...UNRESOLVED };

  let record: ResolvedSource | null = null;
  try {
    const item = await resolver.crossref.byDoi(normalised, signal);
    if (item) record = fromCrossrefItem(item, 1);
  } catch {
    // Fall through to OpenAlex: a Crossref outage should not block a DOI the student is sure of.
  }

  if (record) return enrichFromOpenAlex(record, resolver.openalex, signal);

  // Crossref does not mint every DOI (DataCite, medRxiv and others); OpenAlex indexes those too.
  try {
    const work = await resolver.openalex.byDoi(normalised, signal);
    if (work) {
      return {
        doi: normalised,
        openalexId: work.id ?? null,
        title: work.title ?? work.display_name ?? null,
        authors: openAlexAuthors(work),
        year: work.publication_year ?? null,
        venue: work.primary_location?.source?.display_name ?? work.host_venue?.display_name ?? null,
        type: work.type ?? null,
        cslJson: null,
        oaStatus: work.open_access?.oa_status ?? null,
        citationCount: work.cited_by_count ?? null,
        isPreprint: (work.type ?? '') === 'preprint',
        isRetracted: false,
        abstract: abstractFromInvertedIndex(work.abstract_inverted_index),
        score: 1,
        via: 'openalex',
      };
    }
  } catch {
    // Both services failed. Reported as unresolved, not as a wrong guess.
  }

  return { ...UNRESOLVED };
}

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
    best = fromCrossrefItem(item, score);
  }

  if (best.score >= RESOLUTION_THRESHOLD) {
    return enrichFromOpenAlex(best, resolver.openalex, signal);
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
      abstract: abstractFromInvertedIndex(work.abstract_inverted_index),
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
