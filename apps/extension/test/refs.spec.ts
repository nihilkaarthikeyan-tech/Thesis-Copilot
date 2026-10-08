/**
 * Which paper an in-page button saves (ADR-0125). Pinned: an article page is named by its own
 * tags or address — `citation_doi`, the arXiv id of an abstract, the PMID of a PubMed article —
 * and by nothing else; a page whose tags give only a title (an MDPI issue's contents) is no
 * article; arXiv's own DOIs are the arXiv id; an identifier from a message is accepted only if it
 * is exactly what the cleaners make, so nothing but an identifier reaches the library.
 */

import { describe, expect, it } from 'vitest';
import { type PageMeta, pmidFromUrl } from '../src/paper.js';
import {
  articleOnPage,
  checkRef,
  doiRef,
  refDoi,
  refLabel,
  refQuery,
  refsOfItem,
} from '../src/refs.js';

const page = (url: string, meta: Array<[string, string]>, title = ''): PageMeta => ({
  url,
  title,
  meta,
});

describe('the identifiers the library is asked for', () => {
  it('are written the way paste-an-ID reads them', () => {
    expect(refQuery({ kind: 'doi', id: '10.5555/x1' })).toBe('10.5555/x1');
    expect(refQuery({ kind: 'arxiv', id: '2610.00001' })).toBe('arXiv:2610.00001');
    expect(refQuery({ kind: 'pmid', id: '33333333' })).toBe('PMID 33333333');
    expect(refLabel({ kind: 'pmid', id: '33333333' })).toBe('PMID 33333333');
  });

  it('treat an arXiv DOI as the arXiv id it stands for', () => {
    expect(doiRef('https://doi.org/10.48550/arXiv.2610.00001')).toEqual({
      kind: 'arxiv',
      id: '2610.00001',
    });
    expect(doiRef('doi:10.5555/X1.')).toEqual({ kind: 'doi', id: '10.5555/X1' });
    expect(doiRef('not a doi')).toBeNull();
    expect(refDoi({ kind: 'arxiv', id: '2610.00001' })).toBe('10.48550/arxiv.2610.00001');
    expect(refDoi({ kind: 'pmid', id: '1' })).toBeNull();
  });

  it('refuse anything from a message that is not exactly an identifier', () => {
    expect(checkRef({ kind: 'doi', id: '10.5555/x1' })).toEqual({ kind: 'doi', id: '10.5555/x1' });
    expect(checkRef({ kind: 'pmid', id: '33333333' })).toEqual({ kind: 'pmid', id: '33333333' });
    expect(checkRef({ kind: 'arxiv', id: 'hep-th/9901001' })).toEqual({
      kind: 'arxiv',
      id: 'hep-th/9901001',
    });
    for (const bad of [
      null,
      'PMID 1',
      { kind: 'doi', id: '10.5555/x1"><script>' },
      { kind: 'doi', id: ' 10.5555/x1' },
      { kind: 'doi', id: '10.48550/arxiv.2610.00001' }, // an arXiv DOI travels as the arXiv id
      { kind: 'pmid', id: '0123' },
      { kind: 'pmid', id: '1234567890' },
      { kind: 'arxiv', id: '2610.00001v2' },
      { kind: 'isbn', id: '9780262033848' },
      { kind: 'doi', id: `10.5555/${'x'.repeat(300)}` },
    ]) {
      expect(checkRef(bad)).toBeNull();
    }
  });

  it('read a PMID only from a PubMed article’s own address', () => {
    expect(pmidFromUrl('https://pubmed.ncbi.nlm.nih.gov/33333333/')).toBe('33333333');
    expect(pmidFromUrl('https://pubmed.ncbi.nlm.nih.gov/33333333')).toBe('33333333');
    expect(pmidFromUrl('https://pubmed.ncbi.nlm.nih.gov/?term=33333333')).toBeNull();
    expect(pmidFromUrl('https://pubmed.ncbi.nlm.nih.gov/33333333/citations/')).toBeNull();
    expect(pmidFromUrl('https://example.org/33333333/')).toBeNull();
    expect(pmidFromUrl('nonsense')).toBeNull();
  });

  it('for a result: its DOI first, then its PMID; none when it has neither', () => {
    expect(refsOfItem({ doi: '10.5555/x1', pmid: '33333333' })).toEqual([
      { kind: 'doi', id: '10.5555/x1' },
      { kind: 'pmid', id: '33333333' },
    ]);
    expect(refsOfItem({ doi: '10.48550/arxiv.2610.00001' })).toEqual([
      { kind: 'arxiv', id: '2610.00001' },
    ]);
    expect(refsOfItem({ doi: null, pmid: null })).toEqual([]);
  });
});

describe('the article on a page', () => {
  it('is the one its citation_doi names, never one of its references', () => {
    const found = articleOnPage(
      page('https://www.mdpi.com/1660-0000/14/12/1570', [
        ['citation_title', 'Groundwater Recharge'],
        ['citation_reference', 'citation_doi=10.5555/not-this-one'],
        ['citation_doi', '10.5555/ojgs14121570'],
        ['citation_pdf_url', 'https://www.mdpi.com/1660-0000/14/12/1570/pdf'],
      ]),
    );
    expect(found?.refs).toEqual([{ kind: 'doi', id: '10.5555/ojgs14121570' }]);
    expect(found?.dois).toEqual(['10.5555/ojgs14121570']);
    expect(found?.paper.title).toBe('Groundwater Recharge');
    expect(found?.pdfOnPage).toBe(true);
  });

  it('is none when the tags give only a title — an issue’s contents is not an article', () => {
    expect(
      articleOnPage(
        page('https://www.mdpi.com/1660-0000/14/12', [
          ['dc.title', 'Open J. Groundw. Stud., Volume 14, Issue 12 (December 2017)'],
        ]),
      ),
    ).toBeNull();
    expect(articleOnPage(page('https://www.mdpi.com/journal/ojgs', []))).toBeNull();
  });

  it('on arXiv is the e-print in the address, with its arXiv DOI for finding the link', () => {
    const found = articleOnPage(
      page('https://arxiv.org/abs/2610.00001v2', [['citation_title', 'Small Language Models']]),
    );
    expect(found?.refs).toEqual([{ kind: 'arxiv', id: '2610.00001' }]);
    expect(found?.dois).toEqual(['10.48550/arxiv.2610.00001']);
    expect(found?.paper.doi).toBe('10.48550/arxiv.2610.00001');
  });

  it('on PubMed is its DOI, then its PMID — and its PMID alone when it shows no DOI', () => {
    const withDoi = articleOnPage(
      page('https://pubmed.ncbi.nlm.nih.gov/33333333/', [
        ['citation_title', 'Heat stress'],
        ['citation_doi', '10.5555/ohn.2021.0856'],
      ]),
    );
    expect(withDoi?.refs).toEqual([
      { kind: 'doi', id: '10.5555/ohn.2021.0856' },
      { kind: 'pmid', id: '33333333' },
    ]);
    const bare = articleOnPage(
      page('https://pubmed.ncbi.nlm.nih.gov/33333333/', [], 'Heat stress in Chennai - PubMed'),
    );
    expect(bare?.refs).toEqual([{ kind: 'pmid', id: '33333333' }]);
    expect(bare?.paper).toMatchObject({ title: 'Heat stress in Chennai', doi: null });
    expect(bare?.dois).toEqual([]);
    // A search page is no article; a number on another site is no PMID.
    expect(articleOnPage(page('https://pubmed.ncbi.nlm.nih.gov/?term=heat', []))).toBeNull();
    expect(articleOnPage(page('https://example.org/33333333/', []))).toBeNull();
  });

  it('takes a PDF tag only when it is a web address', () => {
    const found = articleOnPage(
      page('https://example.org/a', [
        ['citation_doi', '10.5555/x1'],
        ['citation_pdf_url', 'javascript:alert(1)'],
      ]),
    );
    expect(found?.pdfOnPage).toBe(false);
  });
});
