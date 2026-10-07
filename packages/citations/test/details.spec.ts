import { describe, expect, it } from 'vitest';
import { toCslItem } from '../src/csl.js';
import { authorLines, detailsOf, parseAuthorLines, withDetails } from '../src/details.js';

const source = {
  id: 's1',
  title: 'Barriers to rooftop solar',
  authors: [{ family: 'Kumar', given: 'A' }],
  year: 2020,
  venue: 'Energy Policy',
  doi: '10.1000/abc',
  cslJson: {
    type: 'article-journal',
    title: 'Barriers to rooftop solar',
    subtitle: 'a survey',
    author: [{ family: 'Kumr', given: 'A.' }],
    issued: { 'date-parts': [[2020]] },
    'container-title': ['Energy Policy'],
    volume: '158',
    abstract: 'Kept for retrieval.',
    ISSN: ['0301-4215'],
  },
};

describe("a paper's details (Jenni build plan R15)", () => {
  it('are read from what a citation of it prints now', () => {
    const d = detailsOf(source);
    expect(d).toMatchObject({
      type: 'article-journal',
      title: 'Barriers to rooftop solar: a survey',
      authors: [{ family: 'Kumr', given: 'A.' }],
      year: 2020,
      container: 'Energy Policy',
      volume: '158',
      doi: '10.1000/abc',
    });
  });

  it('written back, change the citation, keep the rest of the record, and drop emptied fields', () => {
    const d = detailsOf(source);
    const fixed = withDetails(source.cslJson, {
      ...d,
      authors: [{ family: 'Kumar', given: 'Asha' }, { literal: 'TERI' }],
      year: 2021,
      volume: '',
      pages: '12-19',
    });
    expect(fixed.abstract).toBe('Kept for retrieval.');
    expect(fixed.ISSN).toEqual(['0301-4215']);
    expect(fixed.volume).toBeUndefined();
    expect(fixed.subtitle).toBeUndefined();
    const item = toCslItem({ ...source, cslJson: fixed });
    expect(item.author).toEqual([{ family: 'Kumar', given: 'Asha' }, { literal: 'TERI' }]);
    expect(item.issued).toEqual({ 'date-parts': [[2021]] });
    expect(item.page).toBe('12-19');
    expect(item.title).toBe('Barriers to rooftop solar: a survey');
  });

  it('turn author lines into names and back', () => {
    const names = parseAuthorLines('Kumar, Asha\n  \nWorld Health Organization\nRao,');
    expect(names).toEqual([
      { family: 'Kumar', given: 'Asha' },
      { literal: 'World Health Organization' },
      { family: 'Rao' },
    ]);
    expect(authorLines(names)).toBe('Kumar, Asha\nWorld Health Organization\nRao');
  });
});
