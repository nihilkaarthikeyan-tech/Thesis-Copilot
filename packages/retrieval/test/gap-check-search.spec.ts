/**
 * The proposal's early gap check, as sent to OpenAlex (docs/JENNI-FIX-LIST.md item 2).
 *
 * Measured 2026-10-04: the student's whole description plus their answer "2" found 0 works;
 * "Pichavaram mangrove soil organic carbon" found 465. The search is the subject words, and a
 * search that finds nothing is tried once more with fewer of them.
 */

import { describe, expect, it } from 'vitest';
import { topicSearchTerms } from '../src/scholarly/keywords.js';
import { OpenAlexClient } from '../src/scholarly/resolve.js';

const MANGROVES =
  'MSc thesis on mangroves in Pichavaram, Tamil Nadu: comparing soil organic carbon in restored ' +
  'and natural stands using field cores and Sentinel-2 imagery. Audience: examiners in ' +
  'environmental science. Argue that restored stands recover carbon within 15 years. 2';

/** A fake OpenAlex that answers each search with the next count, and records what it was sent. */
function fakeOpenAlex(counts: number[]) {
  const searches: string[] = [];
  const client = new OpenAlexClient({
    mailto: 'ops@example.edu',
    sleep: async () => undefined,
    fetch: async (url: string) => {
      searches.push(new URL(url).searchParams.get('search') ?? '');
      const count = counts.shift() ?? 0;
      const results =
        count > 0
          ? [{ title: 'Blue carbon in Pichavaram', publication_year: 2020, doi: null }]
          : [];
      return new Response(JSON.stringify({ meta: { count }, results }), { status: 200 });
    },
  });
  return { client, searches };
}

describe('the gap-check search terms', () => {
  it('are the subject words, not the degree, the audience or the argument', () => {
    expect(topicSearchTerms(MANGROVES)).toEqual([
      'mangroves pichavaram tamil nadu soil organic',
      'mangroves pichavaram tamil',
    ]);
  });

  it('ignore a bare option number', () => {
    expect(topicSearchTerms('Rooftop solar adoption 2')).toEqual([
      'rooftop solar adoption',
      'rooftop solar',
    ]);
  });

  it('have no broader retry when there are only two words', () => {
    expect(topicSearchTerms('rooftop solar')).toEqual(['rooftop solar']);
  });

  it('are empty when nothing but thesis words is left', () => {
    expect(topicSearchTerms('My PhD thesis proposal, 2')).toEqual([]);
  });
});

describe('OpenAlexClient.searchTopicTerms', () => {
  it('sends the key terms, once, when they find something', async () => {
    const { client, searches } = fakeOpenAlex([465]);
    const result = await client.searchTopicTerms(MANGROVES);
    expect(searches).toEqual(['mangroves pichavaram tamil nadu soil organic']);
    expect(result.count).toBe(465);
    expect(result.works).toHaveLength(1);
    expect(result.query).toBe('mangroves pichavaram tamil nadu soil organic');
  });

  it('retries once with fewer terms when the first search finds nothing', async () => {
    const { client, searches } = fakeOpenAlex([0, 120]);
    const result = await client.searchTopicTerms(MANGROVES);
    expect(searches).toEqual([
      'mangroves pichavaram tamil nadu soil organic',
      'mangroves pichavaram tamil',
    ]);
    expect(result.count).toBe(120);
    expect(result.query).toBe('mangroves pichavaram tamil');
  });

  it('stops after the one retry and reports nothing found', async () => {
    const { client, searches } = fakeOpenAlex([0, 0, 50]);
    const result = await client.searchTopicTerms(MANGROVES);
    expect(searches).toHaveLength(2);
    expect(result).toMatchObject({ count: 0, works: [] });
  });

  it('falls back to the text itself when no key word is left', async () => {
    const { client, searches } = fakeOpenAlex([3]);
    await client.searchTopicTerms('PhD thesis?');
    expect(searches).toEqual(['PhD thesis']);
  });
});
