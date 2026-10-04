/**
 * Europe PMC full text — ADR-0054.
 *
 * The fixtures are real responses recorded from the live API on 2026-10-04
 * (`test/fixtures/scholarly/europepmc-*`): the DOI search for a CC BY PLOS ONE paper and its
 * JATS full text. Content is as received; Biome re-indents the JSON.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { chunkText } from '../src/chunker.js';
import { EuropePmcClient, jatsToText } from '../src/scholarly/europepmc.js';

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/scholarly/${name}`, import.meta.url), 'utf8');

const XML = fixture('europepmc-PMC5646769.xml');
const SEARCH = fixture('europepmc-search-pone.0185809.json');
const DOI = '10.1371/journal.pone.0185809';

function client(routes: (url: string) => Response) {
  const fetchFn = vi.fn(async (url: string) => routes(url));
  return {
    fetchFn,
    epmc: new EuropePmcClient({
      mailto: 'test@example.org',
      fetch: fetchFn,
      sleep: async () => {},
    }),
  };
}

describe('jatsToText on a real article', () => {
  const parsed = jatsToText(XML);

  it('reads the body into sections named by their top-level headings', () => {
    expect(parsed).not.toBeNull();
    const names = [...new Set(parsed?.sections.map((s) => s.section))];
    expect(names[0]).toBe('Abstract');
    expect(names).toContain('Introduction');
    expect(names.length).toBeGreaterThanOrEqual(4);
  });

  it('keeps a table row by row, so its numbers can be quoted', () => {
    // Table 1's first data row, as published: 1989, 8 locations, 0 resampled, 162 samples.
    expect(parsed?.text).toContain('Table 1. Overview of malaise-trap samples sizes.');
    expect(parsed?.text).toMatch(/\n1989 \| 8 \| 0 \| 162 \| 146\.62 \| 12\.81\n/);
    expect(parsed?.text).toMatch(/Year \| Number of locations \|/);
  });

  it('drops markup and references, keeping the in-text reference numbers', () => {
    expect(parsed?.text).not.toMatch(/<[a-z]/i);
    expect(parsed?.text).toContain('pollination [1, 2]');
    expect(
      parsed?.text.includes(String.fromCharCode(1)) ||
        parsed?.text.includes(String.fromCharCode(2)),
    ).toBe(false);
  });

  it('gives spans that match the text and feed the chunker', () => {
    const text = parsed?.text ?? '';
    for (const span of parsed?.sections ?? []) {
      expect(span.end).toBeGreaterThan(span.start);
      expect(span.end).toBeLessThanOrEqual(text.length);
    }
    expect(text.slice(parsed?.sections[1]?.start).startsWith('Loss of insects')).toBe(true);
    const chunks = chunkText({ text, sections: parsed?.sections ?? [] });
    expect(chunks.length).toBeGreaterThan(10);
    expect(chunks.some((c) => c.section === 'Introduction')).toBe(true);
  });

  it('is not full text without a body', () => {
    expect(
      jatsToText('<article><front><abstract><p>Only this.</p></abstract></front></article>'),
    ).toBeNull();
  });
});

describe('EuropePmcClient', () => {
  it('finds the PMC copy by DOI and returns its text', async () => {
    const { epmc, fetchFn } = client((url) =>
      url.includes('/search?')
        ? new Response(SEARCH, { status: 200 })
        : new Response(XML, { status: 200, headers: { 'content-type': 'application/xml' } }),
    );
    const result = await epmc.fullText(`https://doi.org/${DOI.toUpperCase()}`);
    expect(result?.pmcid).toBe('PMC5646769');
    expect(result?.text).toContain('Table 1.');
    expect(fetchFn.mock.calls[0]?.[0]).toContain(encodeURIComponent(`DOI:"${DOI}"`));
    expect(fetchFn.mock.calls[1]?.[0]).toBe(
      'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC5646769/fullTextXML',
    );
  });

  it('never uses a hit whose DOI is not the one asked for', async () => {
    const { epmc, fetchFn } = client(() => new Response(SEARCH, { status: 200 }));
    expect(await epmc.fullText('10.1371/journal.pone.018580')).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('skips a paper outside the open-access subset', async () => {
    const closed = SEARCH.replace(/"isOpenAccess": ?"Y"/, '"isOpenAccess": "N"');
    expect(closed).not.toBe(SEARCH);
    const { epmc, fetchFn } = client(() => new Response(closed, { status: 200 }));
    expect(await epmc.fullText(DOI)).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('answers null when the full text is gone', async () => {
    const { epmc } = client((url) =>
      url.includes('/search?')
        ? new Response(SEARCH, { status: 200 })
        : new Response('', { status: 404 }),
    );
    expect(await epmc.fullText(DOI)).toBeNull();
  });
});
