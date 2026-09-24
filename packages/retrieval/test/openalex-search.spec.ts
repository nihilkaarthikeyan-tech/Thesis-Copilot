/**
 * What OpenAlex is sent.
 *
 * Found on 2026-09-24 by running chat's Find papers against the live API: OpenAlex answers a
 * search containing `?` or `*` with HTTP 400 ("Wildcards (* or ?) require exact (no-stem) search"),
 * so every question ending in a question mark came back empty. And a question sent as typed ranks
 * on its question words — "What Will 5G Be?" was first for a question about rooftop solar.
 */

import { describe, expect, it } from 'vitest';
import { OpenAlexDiscovery } from '../src/scholarly/discover.js';
import { keywordsOf, openAlexSearchText } from '../src/scholarly/keywords.js';
import { OpenAlexClient } from '../src/scholarly/resolve.js';

describe('an OpenAlex search', () => {
  it('never contains a wildcard, from any of the three places that search', async () => {
    const urls: string[] = [];
    const options = {
      mailto: 'ops@example.edu',
      sleep: async () => undefined,
      fetch: async (url: string) => {
        urls.push(url);
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      },
    };
    await new OpenAlexDiscovery(options).search('What limits rooftop solar adoption?');
    await new OpenAlexClient(options).search('Is this the end? A review of * notation');
    await new OpenAlexClient(options).searchTopic('solar dryers?');
    expect(urls.map((url) => new URL(url).searchParams.get('search'))).toEqual([
      'What limits rooftop solar adoption',
      'Is this the end A review of notation',
      'solar dryers',
    ]);
  });

  it('keeps everything that is not a wildcard', () => {
    expect(openAlexSearchText('  C++ and C#: a comparison  ')).toBe('C++ and C#: a comparison');
  });
});

describe('the words worth searching for', () => {
  it('drops the question around them', () => {
    expect(
      keywordsOf('What does the literature say about rooftop solar adoption barriers?'),
    ).toEqual(['rooftop', 'solar', 'adoption', 'barriers']);
  });

  it('keeps acronyms and numbers, and each word once', () => {
    expect(keywordsOf('AI in 5G networks: AI scheduling')).toEqual([
      'ai',
      '5g',
      'networks',
      'scheduling',
    ]);
  });

  it('stops at the limit, in the order the student wrote them', () => {
    expect(keywordsOf('alpha beta gamma delta epsilon zeta eta theta', 3)).toEqual([
      'alpha',
      'beta',
      'gamma',
    ]);
  });

  it('gives nothing for a question made only of question words', () => {
    expect(keywordsOf('What does it say?')).toEqual([]);
  });
});
