/**
 * The facts a library row and a citation card show about a paper: how often it is cited, whether
 * it is free to read, and its journal's 2-year mean citedness (coverage map rows 21, 32, 46).
 *
 * The work records are real OpenAlex responses, recorded from the live API on 2026-10-04 and
 * stored unedited apart from Biome's whitespace (`test/fixtures/scholarly/openalex-work-*`):
 *
 * - `pone.0185809` — PLOS ONE, gold open access, with `cited_by_count`;
 * - `nature14539` — Nature, closed at the publisher but green through a repository;
 * - `closed-W2030604100` — fetched with `select=id,open_access`, so it carries no
 *   `cited_by_count` at all: the case where a count must stay unknown, not become 0.
 *
 * The `/sources` record that `journalCitednessOf` reads could not be recorded the same day: the
 * IP's free OpenAlex budget was spent (HTTP 429) and there is no key in the dev `.env`. Its shape
 * is the one ADR-0022 verified; those cases are written inline and say so.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  journalCitednessOf,
  OpenAlexClient,
  type OpenAlexWork,
  openAccessFromStatus,
  openAlexWorkMetrics,
  resolveByDoi,
} from '../src/scholarly/resolve.js';

const work = (name: string): OpenAlexWork =>
  JSON.parse(
    readFileSync(
      new URL(`./fixtures/scholarly/openalex-work-${name}.json`, import.meta.url),
      'utf8',
    ),
  ) as OpenAlexWork;

describe('openAlexWorkMetrics — a recorded OpenAlex work', () => {
  it('reads the count, the gold status and the journal from a PLOS ONE record', () => {
    expect(openAlexWorkMetrics(work('pone.0185809'))).toEqual({
      citationCount: 3595,
      oaStatus: 'gold',
      isOpenAccess: true,
      venueOpenalexId: 'S202381698',
    });
  });

  it('reads green open access for a paper the publisher keeps closed', () => {
    const metrics = openAlexWorkMetrics(work('nature14539'));
    expect(metrics.citationCount).toBe(85363);
    expect(metrics.oaStatus).toBe('green');
    expect(metrics.isOpenAccess).toBe(true);
    expect(metrics.venueOpenalexId).toBe('S137773608');
  });

  it('leaves the count unknown when the record has none, and reads closed as closed', () => {
    expect(openAlexWorkMetrics(work('closed-W2030604100'))).toEqual({
      citationCount: null,
      oaStatus: 'closed',
      isOpenAccess: false,
      venueOpenalexId: null,
    });
  });

  it('never turns a missing or malformed field into a figure', () => {
    expect(openAlexWorkMetrics({})).toEqual({
      citationCount: null,
      oaStatus: null,
      isOpenAccess: null,
      venueOpenalexId: null,
    });
    const odd = { cited_by_count: -1, open_access: { oa_status: '  ' } } as OpenAlexWork;
    expect(openAlexWorkMetrics(odd).citationCount).toBeNull();
    expect(openAlexWorkMetrics(odd).oaStatus).toBeNull();
    expect(openAlexWorkMetrics({ cited_by_count: 0 }).citationCount).toBe(0);
  });
});

describe('openAccessFromStatus', () => {
  it('maps the OpenAlex and Unpaywall statuses, and knows nothing else', () => {
    for (const s of ['gold', 'green', 'hybrid', 'bronze', 'diamond', 'open', 'Gold']) {
      expect(openAccessFromStatus(s)).toBe(true);
    }
    expect(openAccessFromStatus('closed')).toBe(false);
    expect(openAccessFromStatus(null)).toBeNull();
    expect(openAccessFromStatus(undefined)).toBeNull();
    expect(openAccessFromStatus('')).toBeNull();
    expect(openAccessFromStatus('something-new')).toBeNull();
  });
});

describe('journalCitednessOf (shape per ADR-0022; written inline, see the header)', () => {
  it('takes a journal figure and refuses anything else', () => {
    expect(
      journalCitednessOf({ type: 'journal', summary_stats: { '2yr_mean_citedness': 3.1 } }),
    ).toBe(3.1);
    expect(
      journalCitednessOf({ type: 'repository', summary_stats: { '2yr_mean_citedness': 0.17 } }),
    ).toBeNull();
    expect(journalCitednessOf({ type: 'journal', summary_stats: null })).toBeNull();
    expect(journalCitednessOf({ type: 'journal' })).toBeNull();
  });
});

describe('resolveByDoi stores what the recorded record says', () => {
  it('a DOI only OpenAlex knows comes back with its count, status and journal', async () => {
    const body = readFileSync(
      new URL('./fixtures/scholarly/openalex-work-pone.0185809.json', import.meta.url),
      'utf8',
    );
    const fetchFn = vi.fn(async (url: string) =>
      url.includes('api.openalex.org')
        ? new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
        : new Response('not found', { status: 404 }),
    );
    const options = { mailto: 'you@example.com', fetch: fetchFn, sleep: async () => undefined };
    const crossref = { byDoi: async () => null } as never;
    const resolved = await resolveByDoi('10.1371/journal.pone.0185809', {
      crossref,
      openalex: new OpenAlexClient(options),
    });
    expect(resolved.via).toBe('openalex');
    expect(resolved.citationCount).toBe(3595);
    expect(resolved.oaStatus).toBe('gold');
    expect(resolved.venueOpenalexId).toBe('S202381698');
  });
});
