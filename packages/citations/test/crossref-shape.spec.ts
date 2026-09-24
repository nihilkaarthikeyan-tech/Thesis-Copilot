/**
 * A source resolved against Crossref, rendered.
 *
 * `Source.cslJson` stores the record the resolver received, and for a Crossref match that is
 * Crossref's own `works` shape, not CSL-JSON: `title` and `container-title` are lists, and `type`
 * uses Crossref's vocabulary. Every fixture in the other specs used tidy strings, so none of them
 * ever met the shape real data has — and every Crossref-resolved source printed in the thesis
 * bibliography like this:
 *
 *   LeCun, Y. (2015). LeCun, Yann, Bengio, Yoshua, Hinton, Geoffrey (2015). Deep learning.
 *   Nature. https://doi.org/10.1038/nature14539. In (Vol. 521, pp. 436–444).
 *
 * — the raw reference line as the title, and "In ()" where the journal belonged. Found by
 * exporting a library and opening the .bib (2026-09-24). The record below is trimmed from the real
 * Crossref response for that DOI; the fields are the ones Crossref actually sends.
 */

import { describe, expect, it } from 'vitest';
import { toCslItem } from '../src/csl.js';
import { renderCitations } from '../src/render.js';

const CROSSREF_WORK = {
  DOI: '10.1038/nature14539',
  URL: 'https://doi.org/10.1038/nature14539',
  ISSN: ['0028-0836', '1476-4687'],
  type: 'journal-article',
  title: ['Deep learning'],
  'container-title': ['Nature'],
  'short-container-title': ['Nature'],
  author: [
    { given: 'Yann', family: 'LeCun', sequence: 'first', affiliation: [] },
    { given: 'Yoshua', family: 'Bengio', sequence: 'additional', affiliation: [] },
    { given: 'Geoffrey', family: 'Hinton', sequence: 'additional', affiliation: [] },
  ],
  issued: { 'date-parts': [[2015, 5, 27]] },
  volume: '521',
  issue: '7553',
  page: '436-444',
  publisher: 'Springer Science and Business Media LLC',
};

/** The row as the resolve job writes it: good columns, and the raw line from the paper. */
const SOURCE = {
  id: 's1',
  title: 'Deep learning',
  venue: 'Nature',
  year: 2015,
  doi: '10.1038/nature14539',
  rawReference:
    'LeCun, Yann, Bengio, Yoshua, Hinton, Geoffrey (2015). Deep learning. Nature. https://doi.org/10.1038/nature14539',
  cslJson: CROSSREF_WORK,
};

describe('toCslItem on a Crossref record', () => {
  const item = toCslItem(SOURCE);

  it('reads the title out of Crossref’s list', () => {
    expect(item.title).toBe('Deep learning');
  });

  it('reads the journal out of Crossref’s list', () => {
    expect(item['container-title']).toBe('Nature');
    expect(item['container-title-short']).toBe('Nature');
  });

  it('maps Crossref’s type to the CSL type citeproc knows', () => {
    expect(item.type).toBe('article-journal');
  });

  it('keeps every author', () => {
    expect(item.author?.map((a) => a.family)).toEqual(['LeCun', 'Bengio', 'Hinton']);
  });

  it('leaves no Crossref-only list where CSL expects a string', () => {
    expect(typeof item.title).toBe('string');
    expect(typeof item['container-title']).toBe('string');
    expect(item['short-container-title']).toBeUndefined();
  });

  it('prefers the row’s title column to the raw reference line when the record has none', () => {
    const item2 = toCslItem({ ...SOURCE, cslJson: { ...CROSSREF_WORK, title: [] } });
    expect(item2.title).toBe('Deep learning');
  });

  it('joins a Crossref subtitle to the title, the way style guides print one', () => {
    const item3 = toCslItem({
      ...SOURCE,
      cslJson: { ...CROSSREF_WORK, title: ['Deep learning'], subtitle: ['a review'] },
    });
    expect(item3.title).toBe('Deep learning: a review');
    expect(item3.subtitle).toBeUndefined();
  });

  it('maps the other Crossref types a thesis cites', () => {
    const typeOf = (type: string) =>
      toCslItem({ ...SOURCE, cslJson: { ...CROSSREF_WORK, type } }).type;
    expect(typeOf('proceedings-article')).toBe('paper-conference');
    expect(typeOf('book-chapter')).toBe('chapter');
    expect(typeOf('posted-content')).toBe('article');
    expect(typeOf('dissertation')).toBe('thesis');
    // A type that is already CSL is left alone.
    expect(typeOf('report')).toBe('report');
  });
});

describe('the bibliography entry a student submits', () => {
  const render = (style: string) =>
    renderCitations({
      style,
      sources: [SOURCE],
      citations: [{ key: 'k1', sourceId: 's1' }],
    }).bibliography[0]?.text ?? '';

  it('is a correct APA reference, not the raw line wearing a title', () => {
    const apa = render('apa');
    expect(apa).toContain('LeCun, Y., Bengio, Y., & Hinton, G. (2015).');
    expect(apa).toContain('Deep learning. Nature, 521');
    expect(apa).toContain('436–444');
    expect(apa).not.toContain('LeCun, Yann, Bengio');
    expect(apa).not.toContain('In (');
  });

  it('names the journal in IEEE too', () => {
    const ieee = render('ieee');
    expect(ieee).toContain('“Deep learning,”');
    expect(ieee).toContain('Nature');
    expect(ieee).not.toContain('LeCun, Yann, Bengio');
  });
});
