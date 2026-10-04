/**
 * The matching passage on each "Find papers" result (coverage-map row 23), through
 * `POST /chat/web`.
 *
 * The indexes are not called: arXiv and PubMed answer with their recorded, unedited responses
 * (`packages/retrieval/test/fixtures/scholarly/`, recorded 2026-09-24), parsed by the clients'
 * own parsers, and OpenAlex answers with nothing — there is no recorded OpenAlex search, and the
 * machine's free OpenAlex budget may be spent. What is pinned: every passage is a verbatim slice
 * of the result's own abstract, it is the sentence with the query's words in it, and a result with
 * no abstract has no passage.
 */

import { readFileSync } from 'node:fs';
import {
  OpenAlexDiscovery,
  parseArxivFeed,
  parsePubmedArticles,
  workFromArxiv,
  workFromPubmed,
} from '@tc/retrieval';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ScholarlyIndexes } from '../src/common/scholarly-indexes.service.js';
import { type WebResult, webResultOf } from '../src/modules/assist/web-scope.service.js';
import { type Harness, startHarness } from './_harness.js';

const fixture = (name: string): string =>
  readFileSync(
    new URL(`../../../packages/retrieval/test/fixtures/scholarly/${name}`, import.meta.url),
    'utf8',
  );

const arxivWorks = parseArxivFeed(fixture('arxiv-search.xml')).map(workFromArxiv);
const pubmedWorks = parsePubmedArticles(fixture('pubmed-efetch.xml')).map(workFromPubmed);

const QUESTION = 'What are the barriers to rooftop solar adoption?';

describe('the passage on a web result', () => {
  let h: Harness;
  let documentId: string;
  let results: WebResult[];

  beforeAll(async () => {
    h = await startHarness('web-passage@example.com');
    const created = await h.api('/documents', {
      method: 'POST',
      headers: { origin: 'http://localhost:3000' },
      body: JSON.stringify({ title: 'Rooftop solar in Kerala', entryPath: 'A_TOPIC' }),
    });
    documentId = ((await created.json()) as { id: string }).id;

    const indexes = h.app.get(ScholarlyIndexes);
    vi.spyOn(indexes.arxiv, 'search').mockResolvedValue(arxivWorks);
    vi.spyOn(indexes.pubmed, 'search').mockResolvedValue(pubmedWorks);
    vi.spyOn(OpenAlexDiscovery.prototype, 'search').mockResolvedValue([]);

    const res = await h.api('/chat/web', {
      method: 'POST',
      headers: { origin: 'http://localhost:3000' },
      body: JSON.stringify({ documentId, message: QUESTION }),
    });
    expect(res.status).toBe(200);
    results = ((await res.json()) as { results: WebResult[] }).results;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await h?.stop();
  });

  it('returns the recorded works', () => {
    expect(results.length).toBe(arxivWorks.length + pubmedWorks.length);
  });

  it('gives each result with a matching abstract a verbatim passage from that abstract', () => {
    const withPassage = results.filter((r) => r.matchedPassage);
    expect(withPassage.length).toBeGreaterThan(0);
    for (const result of withPassage) {
      const passage = result.matchedPassage;
      if (!passage) continue;
      expect(result.abstract).toContain(passage.text);
      expect(passage.highlights.length).toBeGreaterThan(0);
      for (const h of passage.highlights) {
        const word = passage.text.slice(h.start, h.end).toLowerCase();
        expect(['barriers', 'barrier', 'rooftop', 'solar', 'adoption']).toContain(word);
      }
    }
  });

  it('picks the sentence that names the question’s subject', () => {
    const digitalTwin = results.find((r) => r.title.startsWith(arxivWorks[1]?.title ?? '-'));
    expect(digitalTwin?.matchedPassage?.text).toMatch(
      /^Residential rooftop solar adoption is considered crucial/,
    );
  });

  it('has no passage where there is no abstract', () => {
    for (const result of results.filter((r) => !r.abstract)) {
      expect(result.matchedPassage).toBeNull();
    }
    const none = webResultOf(
      { ...(arxivWorks[0] as (typeof arxivWorks)[number]), abstract: null },
      QUESTION,
      { dois: new Set(), titles: new Set() },
    );
    expect(none.matchedPassage).toBeNull();
  });

  it('makes no AI call', async () => {
    expect(await h.prisma.aiCallLog.count({ where: { userId: h.userId } })).toBe(0);
  });
});
