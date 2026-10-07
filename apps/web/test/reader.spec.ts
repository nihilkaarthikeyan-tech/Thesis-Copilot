/**
 * The paper reader's pure parts (ADR-0068): its address, search over text, the passage as it is
 * quoted, and the hand-off to the editor.
 */

import { describe, expect, it } from 'vitest';
import {
  cleanPassage,
  countMatches,
  findAll,
  findInLibrary,
  HANDOFF_TTL_MS,
  matchLabel,
  normaliseDoi,
  normaliseQuery,
  parseHandoff,
  quoteWithCitation,
  quoteWithCitationHtml,
  readerHref,
  SearchIndex,
  stepMatch,
} from '../src/lib/reader';

describe('readerHref', () => {
  it('is the path the Chrome add-on deep-links to', () => {
    expect(readerHref('d1', 's1')).toBe('/app/d/d1/sources/s1');
  });
  it('opens at a page only for a real page number', () => {
    expect(readerHref('d1', 's1', 4)).toBe('/app/d/d1/sources/s1?page=4');
    expect(readerHref('d1', 's1', null)).toBe('/app/d/d1/sources/s1');
    expect(readerHref('d1', 's1', 0)).toBe('/app/d/d1/sources/s1');
    expect(readerHref('d1', 's1', 2.5)).toBe('/app/d/d1/sources/s1');
  });
  it('marks a citation’s passage', () => {
    expect(readerHref('d1', 's1', 4, 'c9')).toBe('/app/d/d1/sources/s1?page=4&chunk=c9');
    expect(readerHref('d1', 's1', null, 'c9')).toBe('/app/d/d1/sources/s1?chunk=c9');
  });
});

describe('cleanPassage', () => {
  it('joins a word the PDF split across a line, and flattens the line breaks', () => {
    expect(cleanPassage('the hydro-\nlogy of hard\nrock  aquifers')).toBe(
      'the hydrology of hard rock aquifers',
    );
  });
  it('keeps a real hyphen', () => {
    expect(cleanPassage('long-term recharge')).toBe('long-term recharge');
    expect(cleanPassage('Kerala-\nIndia')).toBe('Kerala- India');
  });
});

describe('quoteWithCitation', () => {
  it('puts the passage in quotation marks and the label after it', () => {
    expect(quoteWithCitation('The water table\nrose by 1.2 m.', '(Kumar, 2021, p. 4)')).toBe(
      '“The water table rose by 1.2 m.” (Kumar, 2021, p. 4)',
    );
  });
  it('works for a numeric label', () => {
    expect(quoteWithCitation('Recharge rose.', '[3]')).toBe('“Recharge rose.” [3]');
  });
  it('puts a note style’s note on its own line', () => {
    expect(quoteWithCitation('Recharge rose.', 'A. Kumar, “Recharge,” 4.', true)).toBe(
      '“Recharge rose.”\nA. Kumar, “Recharge,” 4.',
    );
  });
  it('copies the quotation alone when there is no label', () => {
    expect(quoteWithCitation('Recharge rose.', '  ')).toBe('“Recharge rose.”');
  });
});

describe('search', () => {
  it('finds a word regardless of case and line breaks', () => {
    expect(
      countMatches('Recharge wells.\nThe WATER table\nrose; the water\ntable fell.', 'water table'),
    ).toBe(2);
  });
  it('counts matches without overlapping', () => {
    expect(findAll('aaaa', 'aa')).toEqual([0, 2]);
  });
  it('finds nothing for an empty query', () => {
    expect(countMatches('anything', '   ')).toBe(0);
    expect(normaliseQuery('  Water   Table ')).toBe('water table');
  });
  it('maps each indexed character back to its origin, and a gap to none', () => {
    const index = new SearchIndex<number>();
    index.push('Ab  c', (i) => i);
    index.gap();
    index.push('d', (i) => 100 + i);
    expect(index.text).toBe('ab c d');
    expect(index.origins).toEqual([0, 1, 2, 4, null, 100]);
  });
  it('labels the count as "x of y"', () => {
    expect(matchLabel(0, 12, 'water')).toBe('1 of 12');
    expect(matchLabel(11, 12, 'water')).toBe('12 of 12');
    expect(matchLabel(0, 0, 'water')).toBe('No matches');
    expect(matchLabel(0, 0, '')).toBe('');
  });
  it('steps through matches and wraps at both ends', () => {
    expect(stepMatch(0, 3, 1)).toBe(1);
    expect(stepMatch(2, 3, 1)).toBe(0);
    expect(stepMatch(0, 3, -1)).toBe(2);
    expect(stepMatch(0, 0, 1)).toBe(0);
  });
});

describe('parseHandoff', () => {
  const now = 1_000_000;
  const cite = {
    kind: 'cite',
    documentId: 'd1',
    sourceId: 's1',
    chunkId: null,
    page: 4,
    label: 'Kumar 2021',
    title: 'Recharge',
    at: now - 1_000,
  };
  it('reads a fresh hand-off for this thesis', () => {
    expect(parseHandoff(JSON.stringify(cite), 'd1', now)).toMatchObject({ kind: 'cite', page: 4 });
  });
  it('ignores another thesis, a stale one, and junk', () => {
    expect(parseHandoff(JSON.stringify(cite), 'd2', now)).toBeNull();
    expect(
      parseHandoff(JSON.stringify({ ...cite, at: now - HANDOFF_TTL_MS - 1 }), 'd1', now),
    ).toBeNull();
    expect(parseHandoff('{not json', 'd1', now)).toBeNull();
    expect(parseHandoff(JSON.stringify({ ...cite, kind: 'other' }), 'd1', now)).toBeNull();
    expect(parseHandoff(null, 'd1', now)).toBeNull();
  });
});

describe('findInLibrary', () => {
  const library = [
    { id: 'a', doi: '10.1000/ABC', rawReference: null },
    { id: 'b', doi: null, rawReference: 'Kumar A. Recharge wells. 2021.' },
  ];
  it('matches a DOI however it is written', () => {
    expect(findInLibrary(library, { doi: 'https://doi.org/10.1000/abc' })?.id).toBe('a');
    expect(normaliseDoi('doi: 10.1000/ABC')).toBe('10.1000/abc');
  });
  it('matches the reference it was added from', () => {
    expect(
      findInLibrary(library, { doi: null, reference: { raw: 'Kumar A. Recharge wells. 2021.' } })
        ?.id,
    ).toBe('b');
  });
  it('finds nothing for a paper not in the library', () => {
    expect(findInLibrary(library, { doi: '10.1000/zzz', reference: { raw: 'x' } })).toBeUndefined();
  });
});

describe('copy with citation as HTML (Jenni build plan R9)', () => {
  it('carries a real citation the editor parses, with its label, page and passage', () => {
    const html = quoteWithCitationHtml(
      'Night-time   temperatures stayed\n3.1 °C above <rural> levels',
      '(Raja et al., 2026, p. 7)',
      { key: 'c_abc', sourceId: 'src-1', page: 7, chunkId: 'chunk-9' },
    );
    expect(html).toBe(
      '<span>“Night-time temperatures stayed 3.1 °C above &lt;rural&gt; levels” <span data-citation="" data-key="c_abc" data-source-id="src-1" data-chunk-id="chunk-9" data-locator="7" data-label="(Raja et al., 2026, p. 7)">(Raja et al., 2026, p. 7)</span></span>',
    );
  });

  it('without a label it is the quotation alone', () => {
    expect(quoteWithCitationHtml('A finding.', '', { key: 'k', sourceId: 's', page: null })).toBe(
      '<span>“A finding.”</span>',
    );
  });
});
