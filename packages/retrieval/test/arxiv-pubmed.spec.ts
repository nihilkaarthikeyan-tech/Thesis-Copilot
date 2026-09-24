/**
 * arXiv and PubMed — ADR-0020.
 *
 * The fixtures are real responses, recorded from the live APIs on 2026-09-24 and stored unedited
 * (`test/fixtures/scholarly/`): an arXiv search, an arXiv search whose hits were withdrawn, the
 * feed arXiv returns for an id it does not have, two PubMed records (one with a 60-entry reference
 * list), one retracted PubMed record and one PubMed expression of concern. Nothing here is written
 * by hand.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ArxivClient,
  arxivSearchQuery,
  parseArxivFeed,
  workFromArxiv,
} from '../src/scholarly/arxiv.js';
import { arxivDoi, arxivIdFromDoi, arxivIdFromUrl } from '../src/scholarly/arxiv-id.js';
import { interleave } from '../src/scholarly/discover.js';
import { type SlotStore, sharedGate } from '../src/scholarly/http.js';
import { keywordsOf } from '../src/scholarly/keywords.js';
import { personName } from '../src/scholarly/names.js';
import { isNotASource, PubMedClient, parsePubmedArticles } from '../src/scholarly/pubmed.js';
import { type Resolver, resolveByDoi } from '../src/scholarly/resolve.js';

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/scholarly/${name}`, import.meta.url), 'utf8');

describe('reading arXiv’s feed', () => {
  const entries = parseArxivFeed(fixture('arxiv-search.xml'));

  it('reads each e-print’s id, title, authors, abstract and date', () => {
    expect(entries).toHaveLength(2);
    const [first] = entries;
    expect(first?.id).toBe('2212.03516');
    expect(first?.title).toBe(
      'Site Assessment and Layout Optimization for Rooftop Solar Energy Generation in Worldview-3 Imagery',
    );
    expect(first?.authors).toEqual([
      'Zeyad Awwad',
      'Abdulaziz Alharbi',
      'Abdulelah H. Habib',
      'Olivier L. de Weck',
    ]);
    expect(first?.abstract).toMatch(/^With the growth of residential rooftop PV adoption/);
    expect(first?.year).toBe(2022);
    expect(first?.categories).toContain('cs.CV');
  });

  it('keeps the journal DOI of a published e-print, which is the version worth citing', () => {
    expect(entries[0]?.doi).toBe('10.3390/rs15051356');
    expect(entries[0]?.journalRef).toMatch(/^Remote Sensing \(2023\)/);
    expect(workFromArxiv(entries[0] as never)).toMatchObject({
      doi: '10.3390/rs15051356',
      isPreprint: false,
      venue: null,
      via: 'arxiv',
    });
  });

  it('gives an unpublished e-print arXiv’s own DOI, and calls it a preprint', () => {
    const second = entries[1];
    expect(second?.doi).toBeNull();
    expect(workFromArxiv(second as never)).toMatchObject({
      doi: '10.48550/arxiv.2410.08098',
      isPreprint: true,
      venue: 'arXiv',
      oaStatus: 'green',
    });
  });

  it('marks what the authors withdrew', () => {
    const withdrawn = parseArxivFeed(fixture('arxiv-withdrawn.xml'));
    expect(withdrawn.length).toBeGreaterThan(0);
    expect(withdrawn.every((entry) => entry.withdrawn)).toBe(true);
    expect(entries.some((entry) => entry.withdrawn)).toBe(false);
  });

  it('finds nothing, rather than an entry called "Error", for an id arXiv does not have', () => {
    expect(parseArxivFeed(fixture('arxiv-unknown-id.xml'))).toEqual([]);
  });
});

describe('arXiv identifiers', () => {
  it('reads the id from the abstract URL, without its version', () => {
    expect(arxivIdFromUrl('http://arxiv.org/abs/2212.03516v2')).toBe('2212.03516');
    expect(arxivIdFromUrl('http://arxiv.org/abs/hep-th/9901001v1')).toBe('hep-th/9901001');
  });

  it('goes to and from arXiv’s DOI, and ignores every other DOI', () => {
    expect(arxivDoi('2410.08098')).toBe('10.48550/arxiv.2410.08098');
    expect(arxivIdFromDoi('10.48550/arXiv.2410.08098')).toBe('2410.08098');
    expect(arxivIdFromDoi('https://doi.org/10.48550/arxiv.1706.03762')).toBe('1706.03762');
    expect(arxivIdFromDoi('10.3390/rs15051356')).toBeNull();
    expect(arxivIdFromDoi(null)).toBeNull();
  });
});

describe('reading PubMed’s records', () => {
  const records = parsePubmedArticles(fixture('pubmed-efetch.xml'));

  it('reads each article, and not the papers it cites', () => {
    expect(records.map((r) => r.pmid)).toEqual(['38778934', '32678946']);
    const [heliyon] = records;
    expect(heliyon?.title).toBe(
      'Adoption of residential rooftop solar PV systems in South Africa: A scoping review of barriers',
    );
    expect(heliyon?.journal).toBe('Heliyon');
    expect(heliyon?.year).toBe(2024);
    // The article's own DOI — not the first DOI in its 60-entry reference list.
    expect(heliyon?.doi).toBe('10.1016/j.heliyon.2024.e30937');
    expect(heliyon?.pmcid).toBe('PMC11109803');
    expect(heliyon?.authors.slice(0, 3)).toEqual(['Mutumbi U', 'Thondhlana G', 'Ruwanza S']);
    expect(heliyon?.abstract).toMatch(/^Global sustainability challenges/);
    expect(isNotASource(heliyon as never)).toBe(false);
  });

  it('knows a retracted paper when it sees one', () => {
    const [retracted] = parsePubmedArticles(fixture('pubmed-efetch-retracted.xml'));
    expect(retracted?.publicationTypes).toContain('Retracted Publication');
    expect(isNotASource(retracted as never)).toBe(true);
  });

  it('knows a notice about another paper is not a paper', () => {
    // Found by a live search on 2026-09-24: its title quotes the paper, so it ranked beside it.
    const [notice] = parsePubmedArticles(fixture('pubmed-efetch-concern.xml'));
    expect(notice?.title).toMatch(/^Expression of concern:/);
    expect(isNotASource(notice as never)).toBe(true);
  });
});

describe('searching PubMed', () => {
  it('asks for content words, names itself, and never offers a retraction', async () => {
    const urls: string[] = [];
    const client = new PubMedClient({
      mailto: 'ops@example.edu',
      sleep: async () => undefined,
      fetch: async (url) => {
        urls.push(url);
        if (url.includes('esearch.fcgi')) {
          return new Response(
            JSON.stringify({ esearchresult: { idlist: ['41554744', '38778934'] } }),
            { status: 200 },
          );
        }
        // The retracted record and a clean one, as efetch would return them together.
        const clean = fixture('pubmed-efetch.xml');
        const retracted = fixture('pubmed-efetch-retracted.xml');
        return new Response(`${retracted}\n${clean}`, { status: 200 });
      },
    });
    const works = await client.search(
      'What does the literature say about rooftop solar adoption?',
      new Date('2026-09-24T00:00:00Z'),
    );

    const search = new URL(urls[0] ?? '');
    expect(search.searchParams.get('term')).toBe('rooftop solar adoption');
    expect(search.searchParams.get('tool')).toBe('ThesisCopilot');
    expect(search.searchParams.get('email')).toBe('ops@example.edu');
    expect(search.searchParams.get('mindate')).toBe('2011');
    expect(works.map((w) => w.title)).not.toContain(
      'An experimental investigation of unique high stepup boost converter for electric vehicle and solar photovoltaic',
    );
    // esearch's order, restored after efetch.
    expect(works[0]?.doi).toBe('10.1016/j.heliyon.2024.e30937');
    expect(works[0]?.via).toBe('pubmed');
  });
});

describe('searching arXiv', () => {
  it('requires every content word, and leaves withdrawn e-prints out', async () => {
    const urls: string[] = [];
    const client = new ArxivClient({
      mailto: 'ops@example.edu',
      sleep: async () => undefined,
      fetch: async (url) => {
        urls.push(url);
        return new Response(fixture('arxiv-withdrawn.xml'), { status: 200 });
      },
    });
    const works = await client.search('rooftop solar adoption', new Date('2026-09-24T00:00:00Z'));
    expect(new URL(urls[0] ?? '').searchParams.get('search_query')).toBe(
      'all:rooftop AND all:solar AND all:adoption',
    );
    expect(works).toEqual([]);
  });

  it('builds its query from words, not from the question around them', () => {
    expect(
      arxivSearchQuery(keywordsOf('What do papers say about federated learning in 5G?', 4)),
    ).toBe('all:federated AND all:learning AND all:5g');
  });
});

describe('resolving an arXiv DOI OpenAlex has not indexed', () => {
  const none = async () => null;
  const resolver = (entryXml: string): Resolver =>
    ({
      crossref: { byDoi: none },
      openalex: { byDoi: none },
      arxiv: {
        byId: async (id: string) => parseArxivFeed(entryXml).find((e) => e.id === id) ?? null,
      },
    }) as unknown as Resolver;

  it('takes arXiv’s own metadata, with the authors split for citing', async () => {
    const resolved = await resolveByDoi(
      '10.48550/arXiv.2410.08098',
      resolver(fixture('arxiv-search.xml')),
    );
    expect(resolved.via).toBe('arxiv');
    expect(resolved.title).toBe(
      'A Generative AI Technique for Synthesizing a Digital Twin for U.S. Residential Solar Adoption and Generation',
    );
    expect(resolved.venue).toBe('arXiv');
    expect(resolved.isPreprint).toBe(true);
    expect(resolved.abstract).toMatch(/^Residential rooftop solar adoption/);
    expect(resolved.authors[0]).toHaveProperty('family');
    expect(resolved.isRetracted).toBe(false);
  });

  it('resolves a withdrawn e-print, marked the way a retraction is', async () => {
    const [withdrawn] = parseArxivFeed(fixture('arxiv-withdrawn.xml'));
    const resolved = await resolveByDoi(
      arxivDoi(withdrawn?.id ?? ''),
      resolver(fixture('arxiv-withdrawn.xml')),
    );
    expect(resolved.via).toBe('arxiv');
    expect(resolved.isRetracted).toBe(true);
  });

  it('stays unresolved without the arXiv client, as before', async () => {
    const withoutArxiv = { ...resolver(''), arxiv: null } as Resolver;
    const resolved = await resolveByDoi('10.48550/arxiv.2410.08098', withoutArxiv);
    expect(resolved.via).toBeNull();
  });
});

describe('a name, split for a citation style', () => {
  it('takes the last word as the family name, with its particles', () => {
    expect(personName('Zeyad Awwad')).toEqual({ family: 'Awwad', given: 'Zeyad' });
    expect(personName('Olivier L. de Weck')).toEqual({ family: 'de Weck', given: 'Olivier L.' });
    expect(personName('Maria de la Cruz')).toEqual({ family: 'de la Cruz', given: 'Maria' });
    expect(personName('Martin Luther King Jr.')).toEqual({
      family: 'King',
      given: 'Martin Luther',
      suffix: 'Jr.',
    });
  });

  it('leaves alone what it cannot split with confidence', () => {
    expect(personName('Plato')).toEqual({ literal: 'Plato' });
    expect(personName('Awwad, Zeyad')).toEqual({ literal: 'Awwad, Zeyad' });
  });
});

describe('the shared request slot', () => {
  it('lets one request through per interval, across callers', async () => {
    let clock = 0;
    const keys = new Map<string, number>();
    const store: SlotStore = {
      set: async (key, _value, _px, ms) => {
        const expires = keys.get(key);
        if (expires !== undefined && expires > clock) return null;
        keys.set(key, clock + ms);
        return 'OK';
      },
    };
    const sleep = async (ms: number) => {
      clock += ms;
    };
    const gate = sharedGate('arxiv', store, 'slot:arxiv', 3_000, { sleep, now: () => clock });
    const times: number[] = [];
    for (let i = 0; i < 3; i++) {
      await gate();
      times.push(clock);
    }
    expect(times[0]).toBe(0);
    expect((times[1] ?? 0) - (times[0] ?? 0)).toBeGreaterThanOrEqual(3_000);
    expect((times[2] ?? 0) - (times[1] ?? 0)).toBeGreaterThanOrEqual(3_000);
  });

  it('gives up rather than wait forever', async () => {
    let clock = 0;
    const store: SlotStore = { set: async () => null };
    const gate = sharedGate('arxiv', store, 'slot:arxiv', 3_000, {
      maxWaitMs: 1_000,
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
    });
    await expect(gate()).rejects.toThrow(/no request slot/);
  });
});

describe('showing every index that answered', () => {
  it('takes from each list in turn', () => {
    expect(interleave([['a1', 'a2', 'a3'], ['b1'], [], ['c1', 'c2']])).toEqual([
      'a1',
      'b1',
      'c1',
      'a2',
      'c2',
      'a3',
    ]);
  });
});
