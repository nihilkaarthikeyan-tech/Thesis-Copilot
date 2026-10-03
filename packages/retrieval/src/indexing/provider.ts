/**
 * Indexing verification — ADR-0042. "Is this journal actually indexed?" is the first question a
 * student asks before submitting, and the first thing a predatory journal lies about. This reports
 * only indexing facts we can *verify*, never ones we assume.
 *
 * Two layers:
 *  - A provider interface, so a licensed source (Scopus, Web of Science) can be slotted in when a
 *    key arrives — those catalogues are paid and are a human step (see docs/PENDING.md).
 *  - A grounded default built from what OpenAlex already tells us per source: DOAJ membership and a
 *    registered ISSN. Everything else is reported `unknown`, not guessed — a venue we cannot
 *    confirm in Scopus is not therefore absent from it.
 *
 * No model, no metered unit: this is a read of fields the journal match already fetched.
 */

import type { JournalCandidate } from '../journals/score.js';

/** Catalogues a venue can be listed in. Extend as real providers are added. */
export type IndexName = 'doaj' | 'issn-registered' | 'scopus' | 'web-of-science';

/** What we can say about one catalogue for one venue. `unknown` never means "no". */
export type IndexVerdict = 'listed' | 'not-listed' | 'unknown';

export type IndexingStatus = {
  issn: readonly string[];
  /** Per catalogue: what we could verify. A catalogue we have no data for is `unknown`. */
  indexes: Record<IndexName, IndexVerdict>;
  /** The catalogues we positively confirmed, for a compact badge list. */
  listedIn: IndexName[];
  /** Which provider produced this (`openalex`, later `scopus`), for display and audit. */
  source: string;
};

export interface IndexingProvider {
  readonly name: string;
  /** Verified indexing for a venue, or null when the venue cannot be identified. */
  forVenue(input: {
    issn?: readonly string[];
    openalexId?: string | null;
  }): Promise<IndexingStatus | null>;
}

const UNKNOWN_ALL: Record<IndexName, IndexVerdict> = {
  doaj: 'unknown',
  'issn-registered': 'unknown',
  scopus: 'unknown',
  'web-of-science': 'unknown',
};

/**
 * The grounded reading of a candidate the journal match already holds: DOAJ membership and whether
 * the venue has a registered ISSN. Scopus and Web of Science stay `unknown` until a licensed
 * provider is configured — we never infer them from citedness or open-access status.
 */
export function indexingOf(candidate: Pick<JournalCandidate, 'issn' | 'inDoaj'>): IndexingStatus {
  const indexes: Record<IndexName, IndexVerdict> = {
    ...UNKNOWN_ALL,
    doaj: candidate.inDoaj ? 'listed' : 'unknown',
    'issn-registered': candidate.issn.length > 0 ? 'listed' : 'not-listed',
  };
  return {
    issn: candidate.issn,
    indexes,
    listedIn: (Object.keys(indexes) as IndexName[]).filter((k) => indexes[k] === 'listed'),
    source: 'openalex',
  };
}

/**
 * The default provider: OpenAlex `/sources` data, mapped by `indexingOf`. Takes a lookup that
 * returns the candidate for an id or ISSN (the journal match's `OpenAlexSources`), so this stays
 * free of transport and testable. Returns null when the venue is not found.
 */
export class OpenAlexIndexing implements IndexingProvider {
  readonly name = 'openalex';

  constructor(
    private readonly lookup: (input: {
      issn?: readonly string[];
      openalexId?: string | null;
    }) => Promise<Pick<JournalCandidate, 'issn' | 'inDoaj'> | null>,
  ) {}

  async forVenue(input: {
    issn?: readonly string[];
    openalexId?: string | null;
  }): Promise<IndexingStatus | null> {
    const candidate = await this.lookup(input);
    return candidate ? indexingOf(candidate) : null;
  }
}
