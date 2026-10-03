/**
 * Journal data from OpenAlex `/sources` — ADR-0040. Turns a thesis's own cited venues and its
 * field + key terms into `JournalCandidate`s for the scorer. Grounded: everything here is a field
 * OpenAlex reports; nothing is invented. `fetch` is injected, so this is testable without a network
 * (§0.3 rule 1).
 */

import { type ScholarlyClientOptions, ScholarlyHttp } from '../scholarly/http.js';
import type { JournalCandidate } from './score.js';

type OpenAlexSource = {
  id?: string;
  display_name?: string;
  issn?: string[] | null;
  issn_l?: string | null;
  host_organization_name?: string | null;
  type?: string | null;
  works_count?: number | null;
  is_oa?: boolean | null;
  is_in_doaj?: boolean | null;
  /** OpenAlex puts the 2-year mean citedness under summary_stats. */
  summary_stats?: { '2yr_mean_citedness'?: number | null } | null;
  apc_usd?: number | null;
  apc_prices?: Array<{ price?: number; currency?: string }> | null;
  x_concepts?: Array<{ display_name?: string; level?: number; score?: number }> | null;
};

type OpenAlexSourceList = { results?: OpenAlexSource[] };

const SELECT =
  'id,display_name,issn,issn_l,host_organization_name,type,works_count,is_oa,is_in_doaj,summary_stats,apc_usd,apc_prices,x_concepts';

/** `S4210…` from a full OpenAlex URL or a bare id. */
export function sourceShortId(id: string | null | undefined): string | null {
  if (!id) return null;
  const m = /S\d+/.exec(id);
  return m ? m[0] : null;
}

function toCandidate(source: OpenAlexSource): JournalCandidate | null {
  const id = sourceShortId(source.id);
  const name = source.display_name?.trim();
  if (!id || !name) return null;
  const apcUsd =
    typeof source.apc_usd === 'number'
      ? source.apc_usd
      : (source.apc_prices?.find((p) => p.currency === 'USD')?.price ?? null);
  return {
    id,
    name,
    issn: [...new Set([...(source.issn ?? []), ...(source.issn_l ? [source.issn_l] : [])])],
    publisher: source.host_organization_name?.trim() || null,
    concepts: (source.x_concepts ?? [])
      .filter(
        (c): c is { display_name: string; level: number; score: number } =>
          Boolean(c.display_name) && typeof c.level === 'number' && typeof c.score === 'number',
      )
      .map((c) => ({ name: c.display_name, level: c.level, score: c.score })),
    worksCount: source.works_count ?? null,
    meanCitedness: source.summary_stats?.['2yr_mean_citedness'] ?? null,
    isOpenAccess: source.is_oa === true,
    inDoaj: source.is_in_doaj === true,
    apcUsd: apcUsd ?? null,
    type: source.type?.toLowerCase() ?? null,
  };
}

/**
 * Gathers candidate journals for a thesis from two grounded places:
 *  1. the OpenAlex sources the thesis's own cited works were published in (passed in as ids), and
 *  2. a `/sources` search on the thesis's field and key terms.
 * De-duplicated by source id. Journals, book series and ebook platforms only (the scorer gates the
 * rest, but filtering here saves calls).
 */
export class OpenAlexSources {
  private readonly http: ScholarlyHttp;

  constructor(options: ScholarlyClientOptions) {
    this.http = new ScholarlyHttp('openalex', options);
  }

  private url(extra: string, perPage: number): string {
    return (
      `https://api.openalex.org/sources?per-page=${perPage}&select=${SELECT}` +
      `&mailto=${encodeURIComponent(this.http.mailto)}&${extra}`
    );
  }

  /** The journals behind a set of OpenAlex source ids (the thesis's cited venues). */
  async byIds(sourceIds: readonly string[], signal?: AbortSignal): Promise<JournalCandidate[]> {
    const ids = [...new Set(sourceIds.map(sourceShortId).filter((x): x is string => Boolean(x)))];
    if (ids.length === 0) return [];
    const out: JournalCandidate[] = [];
    // OpenAlex accepts an OR filter of up to 50 ids per call.
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const filter = `filter=${encodeURIComponent(`openalex_id:${chunk.join('|')}`)}`;
      const body = await this.http.getJson<OpenAlexSourceList>(this.url(filter, 50), signal);
      for (const s of body?.results ?? []) {
        const c = toCandidate(s);
        if (c) out.push(c);
      }
    }
    return out;
  }

  /** Journals matching the thesis's topic, most-published first. */
  async search(query: string, perPage = 25, signal?: AbortSignal): Promise<JournalCandidate[]> {
    const q = query.trim();
    if (!q) return [];
    const filter = `search=${encodeURIComponent(q)}&filter=${encodeURIComponent('type:journal')}&sort=works_count:desc`;
    const body = await this.http.getJson<OpenAlexSourceList>(this.url(filter, perPage), signal);
    return (body?.results ?? []).map(toCandidate).filter((c): c is JournalCandidate => c !== null);
  }

  /** Both sources, de-duplicated: the thesis's cited venues plus a topic search. */
  async gather(
    input: { citedVenueIds: readonly string[]; query: string },
    signal?: AbortSignal,
  ): Promise<JournalCandidate[]> {
    const [byId, bySearch] = await Promise.all([
      this.byIds(input.citedVenueIds, signal).catch(() => []),
      this.search(input.query, 25, signal).catch(() => []),
    ]);
    const seen = new Set<string>();
    const out: JournalCandidate[] = [];
    for (const c of [...byId, ...bySearch]) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
    return out;
  }
}
