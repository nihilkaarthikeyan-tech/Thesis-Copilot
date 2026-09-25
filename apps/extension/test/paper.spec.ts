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
  cleanDoi,
  doiFromUrl,
  type PageMeta,
  paperFrom,
} from '../src/paper.js';

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
    });
  });
});
