// @vitest-environment jsdom
/**
 * Results pages (ADR-0069): what `collectResultList` reads from each site's markup and what
 * `itemsFrom` makes of it. The pages are hand-written fixtures (see the comment at the top of
 * each) following the markup observed on PubMed and arXiv on 2026-10-05 and Scholar's documented
 * markup; nothing here requests a live site.
 *
 * Pinned: the identifiers come from the result itself (PubMed's journal line, arXiv's abstract
 * link, a DOI in Scholar's title link) and from nowhere else; a repeat is one paper; a tampered
 * value is dropped rather than sent; markup in a title stays text.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BULK_MAX, itemsFrom, type RawListing } from '../src/lists.js';
import { collectPageMeta, collectResultList } from '../src/page.js';

function load(name: string): void {
  const html = readFileSync(join(process.cwd(), 'test', 'fixtures', name), 'utf8');
  document.documentElement.innerHTML = new DOMParser().parseFromString(
    html,
    'text/html',
  ).documentElement.innerHTML;
}

describe('PubMed search results', () => {
  it('reads each result’s PMID, title, authors and the DOI in its journal line', () => {
    load('pubmed-results.html');
    const listing = collectResultList('pubmed.ncbi.nlm.nih.gov');
    expect(listing?.site).toBe('pubmed');
    expect(listing?.items).toHaveLength(5);
    expect(listing?.items[0]).toMatchObject({
      pmid: '11111111',
      title: 'Mapping soil salinity in coastal paddy fields with remote sensing.',
      href: 'https://pubmed.ncbi.nlm.nih.gov/11111111/',
    });

    const items = itemsFrom(listing);
    expect(items.map((i) => i.doi)).toEqual([
      '10.1007/s10661-024-00001-x',
      null,
      '10.1016/j.fcr.2021.108170',
      null,
    ]);
    expect(items[0]).toMatchObject({
      key: '10.1007/s10661-024-00001-x',
      title: 'Mapping soil salinity in coastal paddy fields with remote sensing',
      byline: 'Raman K, Iyer S, Das P et al.',
      year: '2024',
      venue: 'Environ Monit Assess',
      reference:
        'Raman K, Iyer S, Das P et al. (2024). Mapping soil salinity in coastal paddy fields with remote sensing. Environ Monit Assess. https://doi.org/10.1007/s10661-024-00001-x',
    });
    // No DOI on the record: keyed by its PMID and looked up by its text.
    expect(items[1]).toMatchObject({ key: 'pmid:22222222', year: '2019', byline: 'Nair V' });
  });

  it('drops a tampered DOI and PMID and keeps markup in a title as text', () => {
    load('pubmed-results.html');
    const items = itemsFrom(collectResultList('pubmed.ncbi.nlm.nih.gov'));
    const tampered = items[3];
    expect(tampered?.doi).toBeNull();
    expect(tampered?.key.startsWith('title:')).toBe(true);
    expect(tampered?.title).toBe('<img src=x onerror=alert(1)> A title with markup in it');
  });

  it('is not read on another site', () => {
    load('pubmed-results.html');
    expect(collectResultList('example.org')).toBeNull();
  });
});

describe('arXiv', () => {
  it('reads a listing page: the id from the abstract link, the title without “Title:”', () => {
    load('arxiv-list.html');
    const items = itemsFrom(collectResultList('arxiv.org'));
    expect(items.map((i) => i.doi)).toEqual([
      '10.48550/arxiv.2610.00001',
      '10.48550/arxiv.2610.00002',
      '10.48550/arxiv.hep-th/9901001',
    ]);
    expect(items[0]).toMatchObject({
      title: 'Small Language Models for Tamil Morphology',
      byline: 'Arun Kumar, Priya Natarajan',
      venue: 'arXiv',
    });
    expect(items[1]?.byline).toBe('A One, B Two, C Three et al.');
  });

  it('reads a search page, and drops a result that does not link to arXiv', () => {
    load('arxiv-search.html');
    const items = itemsFrom(collectResultList('arxiv.org'));
    expect(items.map((i) => i.doi)).toEqual([
      '10.48550/arxiv.2609.12345',
      '10.48550/arxiv.2501.00042',
    ]);
    expect(items[0]).toMatchObject({
      title: 'Transformers for Crop Yield Forecasting',
      byline: 'Meera Iyer, Rohan Shah',
      year: '2026',
    });
  });
});

describe('Google Scholar', () => {
  it('reads only what each result shows: title, byline, and a DOI or arXiv id in its link', () => {
    load('scholar-results.html');
    const listing = collectResultList('scholar.google.com');
    expect(listing?.site).toBe('scholar');
    expect(listing?.items).toHaveLength(3);
    const items = itemsFrom(listing);
    expect(items[0]).toMatchObject({
      title: 'Variational inference: a review for statisticians',
      doi: '10.1080/01621459.2017.1285773',
      byline: 'DM Blei, A Kucukelbir, JD McAuliffe',
      year: '2017',
      venue: 'Journal of the American statistical',
    });
    // "[PDF]" is a label, not part of the title; the arXiv PDF link gives the arXiv DOI.
    expect(items[1]).toMatchObject({
      title: 'Attention is all you need',
      doi: '10.48550/arxiv.1706.03762',
    });
    // A citation-only record: no link, so no DOI — looked up by its text.
    expect(items[2]).toMatchObject({
      title: 'Groundwater markets in South India',
      doi: null,
      byline: 'T Shah',
      year: '1993',
      key: 'title:groundwater markets in south india',
    });
  });

  it('works on Scholar’s country domains', () => {
    load('scholar-results.html');
    expect(collectResultList('scholar.google.co.in')?.items).toHaveLength(3);
  });
});

describe('itemsFrom', () => {
  it('copes with nothing, and with more than a page of results', () => {
    expect(itemsFrom(null)).toEqual([]);
    expect(itemsFrom({ site: 'arxiv', items: 'nope' } as unknown as RawListing)).toEqual([]);
    const many: RawListing = {
      site: 'arxiv',
      items: Array.from({ length: 150 }, (_, i) => ({
        title: `Paper ${i}`,
        byline: '',
        citation: '',
        pmid: '',
        arxivId: '',
        href: `https://arxiv.org/abs/2601.${String(10000 + i)}`,
      })),
    };
    const items = itemsFrom(many);
    expect(items).toHaveLength(100);
    expect(BULK_MAX).toBe(50);
  });
});

describe('collectPageMeta', () => {
  it('reads the meta tags and the content type, not the text', () => {
    document.documentElement.innerHTML =
      '<head><title>Deep learning</title><meta name="citation_DOI" content="10.1038/nature14539"></head><body>Cites 10.1000/other</body>';
    const meta = collectPageMeta();
    expect(meta.meta).toEqual([['citation_doi', '10.1038/nature14539']]);
    expect(meta.title).toBe('Deep learning');
    expect(meta.contentType).toBe('text/html');
    expect(JSON.stringify(meta)).not.toContain('10.1000/other');
  });
});
