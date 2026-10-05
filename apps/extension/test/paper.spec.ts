/**
 * Which paper a page is about (ADR-0031). The page decides what the student adds to their thesis,
 * so what is pinned here is mostly what must *not* happen: a DOI from the reference list, a news
 * article taken for a paper, an arXiv DOI written differently from the one the library stores.
 */

import { arxivDoi as libraryArxivDoi } from '@tc/retrieval';
import { describe, expect, it } from 'vitest';
import {
  arxivDoi,
  arxivIdFromPageUrl,
  cleanArxivId,
  cleanDoi,
  cleanPmid,
  clip,
  doiFromUrl,
  isDoi,
  isPdfUrl,
  type PageMeta,
  paperFrom,
  paperFromLink,
  pdfFilename,
} from '../src/paper.js';

describe('values from a page are checked before they are sent (ADR-0069)', () => {
  it('a DOI must look like one, with nothing that could break out of a request', () => {
    expect(isDoi('10.1038/nature14539')).toBe(true);
    expect(isDoi('10.1000/abc"><script>')).toBe(false);
    expect(isDoi('10.1000/has space')).toBe(false);
    expect(isDoi(`10.1000/${'x'.repeat(200)}`)).toBe(false);
    expect(cleanDoi('doi:10.1000/a\\b')).toBeNull();
    expect(cleanDoi('10.12/short-prefix')).toBeNull();
  });

  it('arXiv ids and PMIDs have their own shapes', () => {
    expect(cleanArxivId('arXiv:2410.08098v3')).toBe('2410.08098');
    expect(cleanArxivId('hep-th/9901001')).toBe('hep-th/9901001');
    expect(cleanArxivId('math.GT/0309136')).toBe('math.GT/0309136');
    expect(cleanArxivId('2410.08098/../../x')).toBeNull();
    expect(cleanArxivId('<b>')).toBeNull();
    expect(cleanPmid('39041937')).toBe('39041937');
    expect(cleanPmid('0123')).toBeNull();
    expect(cleanPmid('1234567890')).toBeNull();
    expect(cleanPmid('12"onload')).toBeNull();
  });

  it('text is made one line and cut to length', () => {
    expect(clip('  a\n\tb\u0000c  ', 100)).toBe('a b c');
    expect(clip('x'.repeat(600), 500)).toHaveLength(500);
    expect(clip(null, 10)).toBe('');
  });

  it('a page’s title and authors are cut to length too', () => {
    const paper = paperFrom(
      page({
        meta: [
          ['citation_title', 'T'.repeat(900)],
          ['citation_doi', '10.1038/x'],
        ],
      }),
    );
    expect(paper?.title).toHaveLength(500);
  });
});

describe('a right-clicked link (ADR-0069)', () => {
  it('names a paper by its DOI or arXiv id', () => {
    expect(paperFromLink('https://doi.org/10.1038/nature14539')?.doi).toBe('10.1038/nature14539');
    expect(
      paperFromLink('https://onlinelibrary.wiley.com/doi/full/10.1002/anie.201915678')?.doi,
    ).toBe('10.1002/anie.201915678');
    const arxiv = paperFromLink('https://arxiv.org/abs/1706.03762v7');
    expect(arxiv).toMatchObject({
      doi: '10.48550/arxiv.1706.03762',
      title: 'arXiv:1706.03762',
      reference: 'https://doi.org/10.48550/arxiv.1706.03762',
    });
  });

  it('a PubMed link, or any other, is not offered', () => {
    expect(paperFromLink('https://pubmed.ncbi.nlm.nih.gov/39041937/')).toBeNull();
    expect(paperFromLink('https://example.com/doi-of-sorts')).toBeNull();
    expect(paperFromLink('javascript:alert(1)')).toBeNull();
  });
});

describe('PDF tabs (ADR-0069)', () => {
  it('knows a PDF by its address', () => {
    expect(isPdfUrl('https://example.org/files/paper.PDF')).toBe(true);
    expect(isPdfUrl('https://arxiv.org/pdf/2410.08098v2')).toBe(true);
    expect(isPdfUrl('https://www.tandfonline.com/doi/pdf/10.1080/01621459.2017.1285773')).toBe(
      true,
    );
    expect(isPdfUrl('https://arxiv.org/abs/2410.08098')).toBe(false);
    expect(isPdfUrl('file:///C:/papers/a.pdf')).toBe(false);
  });

  it('names the upload safely, always ending in .pdf', () => {
    expect(pdfFilename('https://arxiv.org/pdf/2410.08098v2')).toBe('2410.08098v2.pdf');
    expect(pdfFilename('https://example.org/a/My%20Paper%20(final).pdf?dl=1')).toBe(
      'My-Paper-final.pdf',
    );
    expect(pdfFilename('https://example.org/')).toBe('paper.pdf');
    expect(pdfFilename('https://example.org/..%2F..%2Fetc%2Fpasswd')).toBe('etc-passwd.pdf');
  });
});

const page = (over: Partial<PageMeta> = {}): PageMeta => ({
  url: 'https://www.nature.com/articles/nature14539',
  title: 'Deep learning | Nature',
  meta: [],
  ...over,
});

describe('a journal article page', () => {
  const nature = page({
    meta: [
      ['citation_title', 'Deep learning'],
      ['citation_author', 'LeCun, Yann'],
      ['citation_author', 'Bengio, Yoshua'],
      ['citation_author', 'Hinton, Geoffrey'],
      ['citation_journal_title', 'Nature'],
      ['citation_publication_date', '2015/05/28'],
      ['citation_doi', '10.1038/nature14539'],
    ],
  });

  it('is read from its Google Scholar tags', () => {
    expect(paperFrom(nature)).toEqual({
      title: 'Deep learning',
      doi: '10.1038/nature14539',
      reference:
        'LeCun, Yann, Bengio, Yoshua, Hinton, Geoffrey (2015). Deep learning. Nature. https://doi.org/10.1038/nature14539',
      byline: 'LeCun, Yann, Bengio, Yoshua, Hinton, Geoffrey',
      year: '2015',
      venue: 'Nature',
    });
  });

  it('shortens a long author list the way a reference does', () => {
    const many = page({
      meta: [
        ['citation_title', 'A study'],
        ...['A', 'B', 'C', 'D', 'E'].map((a): [string, string] => ['citation_author', a]),
      ],
    });
    expect(paperFrom(many)?.reference).toBe('A, B, C et al. A study.');
  });

  it('takes the article’s own DOI tag, not one of its references', () => {
    const withRefs = page({
      meta: [
        ['citation_reference', 'citation_doi=10.1000/someone.else'],
        ['citation_title', 'Deep learning'],
        ['dc.identifier', 'doi:10.1038/nature14539'],
      ],
    });
    expect(paperFrom(withRefs)?.doi).toBe('10.1038/nature14539');
  });
});

describe('DOIs as pages write them', () => {
  it('cleans prefixes, links and trailing punctuation', () => {
    expect(cleanDoi('doi:10.1038/nature14539')).toBe('10.1038/nature14539');
    expect(cleanDoi('https://doi.org/10.1038/nature14539')).toBe('10.1038/nature14539');
    expect(cleanDoi('http://dx.doi.org/10.1038/nature14539.')).toBe('10.1038/nature14539');
    expect(cleanDoi('10.1002%2Fanie.201915678')).toBe('10.1002/anie.201915678');
    expect(cleanDoi('ISBN 978-0-12-345678-9')).toBeNull();
  });

  it('finds one in a publisher’s article address', () => {
    expect(doiFromUrl('https://onlinelibrary.wiley.com/doi/full/10.1002/anie.201915678')).toBe(
      '10.1002/anie.201915678',
    );
    expect(doiFromUrl('https://www.tandfonline.com/doi/abs/10.1080/01621459.2017.1285773')).toBe(
      '10.1080/01621459.2017.1285773',
    );
    expect(doiFromUrl('https://doi.org/10.1038/nature14539')).toBe('10.1038/nature14539');
    expect(doiFromUrl('https://example.com/blog/10.1038-ish')).toBeNull();
  });

  it('adds a paper found only by its address', () => {
    const paper = paperFrom(
      page({ url: 'https://pubs.acs.org/doi/10.1021/jacs.0c01234', title: 'Some chemistry' }),
    );
    expect(paper?.doi).toBe('10.1021/jacs.0c01234');
    expect(paper?.title).toBe('Some chemistry');
  });
});

describe('arXiv', () => {
  it('reads the id from the abstract page and the PDF, without the version', () => {
    expect(arxivIdFromPageUrl('https://arxiv.org/abs/2410.08098v2')).toBe('2410.08098');
    expect(arxivIdFromPageUrl('https://arxiv.org/pdf/2410.08098v2.pdf')).toBe('2410.08098');
    expect(arxivIdFromPageUrl('https://arxiv.org/pdf/2410.08098')).toBe('2410.08098');
    expect(arxivIdFromPageUrl('https://arxiv.org/abs/hep-th/9901001v1')).toBe('hep-th/9901001');
    expect(arxivIdFromPageUrl('https://example.org/abs/2410.08098')).toBeNull();
  });

  it('writes the DOI exactly as the library stores it, so the duplicate check matches', () => {
    for (const id of ['2410.08098', 'hep-th/9901001', '1706.03762']) {
      expect(arxivDoi(id)).toBe(libraryArxivDoi(id));
    }
    expect(paperFrom(page({ url: 'https://arxiv.org/abs/1706.03762v7', meta: [] }))?.doi).toBe(
      libraryArxivDoi('1706.03762'),
    );
  });
});

describe('pages that are not a paper', () => {
  it('a news article with a title and no DOI is not taken for one', () => {
    expect(
      paperFrom(
        page({
          url: 'https://news.example.com/story',
          title: 'Scientists find something',
          meta: [['og:title', 'Scientists find something']],
        }),
      ),
    ).toBeNull();
  });

  it('a scholarly page without a DOI is added by its title', () => {
    const paper = paperFrom(
      page({
        url: 'https://shodhganga.inflibnet.ac.in/handle/10603/12345',
        meta: [
          ['dc.title', 'Adoption of rooftop solar in rural Karnataka'],
          ['dc.date', '2019'],
        ],
      }),
    );
    expect(paper).toEqual({
      title: 'Adoption of rooftop solar in rural Karnataka',
      doi: null,
      reference: '(2019). Adoption of rooftop solar in rural Karnataka.',
      byline: null,
      year: '2019',
      venue: null,
    });
  });
});
