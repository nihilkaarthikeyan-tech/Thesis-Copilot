/**
 * Library hygiene, the pure half: what counts as the same work, which record a merge keeps, what
 * the "Without full text" view says, and how a chapter's citations are re-pointed.
 *
 * The judgement worth pinning is mostly what is *not* a duplicate: a merge removes a record, and
 * two editions or a preprint and its published version are two things to cite.
 */

import { describe, expect, it } from 'vitest';
import {
  findDuplicates,
  firstAuthor,
  type HygieneSource,
  normaliseDoi,
  normaliseTitle,
  preferKeep,
  repointCitations,
  sameWork,
  titlesMatch,
  whyNoFullText,
} from '../src/modules/sources/library-hygiene.js';

let n = 0;
const src = (over: Partial<HygieneSource> = {}): HygieneSource => {
  n++;
  return {
    id: `s${n}`,
    title: 'Electrode wear in the electrical discharge machining of nickel superalloys',
    year: 2021,
    doi: null,
    authors: [{ family: 'Rao', given: 'P.' }],
    status: 'RESOLVED',
    groundingLevel: 'ABSTRACT',
    hasFile: false,
    citeCount: 0,
    pinCount: 0,
    createdAt: new Date(Date.UTC(2026, 0, n)),
    ...over,
  };
};

describe('normalisation', () => {
  it('folds case, punctuation, spacing, Unicode dashes and quotes, accents and ligatures', () => {
    expect(normaliseTitle('  Deep   Learning:  A “Review” — Part One ')).toBe(
      'deep learning a review part one',
    );
    expect(normaliseTitle('Self‐supervised learning')).toBe(
      normaliseTitle('Self-supervised learning'),
    );
    expect(normaliseTitle('Gödel’s ﬁrst theorem')).toBe('godel s first theorem');
    expect(normaliseTitle("Godel's first theorem")).toBe('godel s first theorem');
  });

  it('reads a DOI however it was written', () => {
    expect(normaliseDoi('https://doi.org/10.1038/NATURE14539')).toBe('10.1038/nature14539');
    expect(normaliseDoi('doi: 10.1038/nature14539.')).toBe('10.1038/nature14539');
    expect(normaliseDoi('http://dx.doi.org/10.1038/nature14539')).toBe('10.1038/nature14539');
    expect(normaliseDoi('not a doi')).toBeNull();
    expect(normaliseDoi(null)).toBeNull();
  });

  it('takes the first author’s family name, or a literal name', () => {
    expect(firstAuthor([{ family: 'Müller' }, { family: 'Rao' }])).toBe('muller');
    expect(firstAuthor([{ literal: 'World Health Organization' }])).toBe(
      'world health organization',
    );
    expect(firstAuthor([])).toBeNull();
    expect(firstAuthor(null)).toBeNull();
  });
});

describe('what is the same work', () => {
  it('the same DOI, written differently, is one work whatever the titles say', () => {
    const a = src({ doi: '10.1/ABC', title: 'One title' });
    const b = src({ doi: 'https://doi.org/10.1/abc', title: 'Quite another', year: 2019 });
    expect(sameWork(a, b)).toBe('SAME_DOI');
  });

  it('two different DOIs are two works, however alike the titles', () => {
    expect(sameWork(src({ doi: '10.1/preprint' }), src({ doi: '10.1/published' }))).toBeNull();
  });

  it('without DOIs, the same title and year is one work', () => {
    expect(
      sameWork(
        src(),
        src({
          title: 'ELECTRODE WEAR in the Electrical-Discharge Machining of Nickel Superalloys.',
        }),
      ),
    ).toBe('SAME_TITLE');
  });

  it('one DOI and one without still match on title and year', () => {
    expect(sameWork(src({ doi: '10.1/x' }), src())).toBe('SAME_TITLE');
  });

  it('a different year, or a missing one, is not the same work', () => {
    expect(sameWork(src(), src({ year: 2022 }))).toBeNull();
    expect(sameWork(src(), src({ year: null }))).toBeNull();
  });

  it('a different first author is not the same work; a missing one does not decide', () => {
    expect(sameWork(src(), src({ authors: [{ family: 'Iyer' }] }))).toBeNull();
    expect(sameWork(src(), src({ authors: null }))).toBe('SAME_TITLE');
  });

  it('allows a typo or two in a long title, never a different number', () => {
    const long = 'Electrode wear in the electrical discharge machining of nickel superalloys';
    expect(
      titlesMatch(
        long,
        'Electrode wear in the electrical discharge machinng of nickel superalloys',
      ),
    ).toBe(true);
    expect(titlesMatch(`${long}: part 1`, `${long}: part 2`)).toBe(false);
    expect(titlesMatch('Research methods, 2nd edition', 'Research methods, 3rd edition')).toBe(
      false,
    );
    // Short titles must match exactly: "Deep learning" and "Deep earning" are not a typo away.
    expect(titlesMatch('Deep learning', 'Deep earning')).toBe(false);
  });
});

describe('which record a merge keeps', () => {
  it('prefers full text, then a PDF, then resolved, then use, then the older one', () => {
    const full = src({ groundingLevel: 'FULL_TEXT' });
    const abstract = src({ citeCount: 9 });
    expect(preferKeep(abstract, full).id).toBe(full.id);

    const withFile = src({ hasFile: true });
    expect(preferKeep(src({ citeCount: 3 }), withFile).id).toBe(withFile.id);

    const cited = src({ citeCount: 2 });
    expect(preferKeep(src({ pinCount: 1 }), cited).id).toBe(cited.id);

    const older = src({ createdAt: new Date(Date.UTC(2020, 0, 1)) });
    expect(preferKeep(src(), older).id).toBe(older.id);
  });
});

describe('findDuplicates', () => {
  it('returns nothing for a clean library', () => {
    expect(findDuplicates([src({ doi: '10.1/a' }), src({ doi: '10.1/b' })])).toEqual([]);
  });

  it('pairs each copy with the one record worth keeping', () => {
    const a = src({ doi: '10.1/a' });
    const b = src({ doi: '10.1/A', groundingLevel: 'FULL_TEXT' });
    const c = src({ doi: 'doi:10.1/a' });
    const pairs = findDuplicates([a, b, c]);
    expect(pairs).toEqual([
      { keepId: b.id, dropId: a.id, reason: 'SAME_DOI' },
      { keepId: b.id, dropId: c.id, reason: 'SAME_DOI' },
    ]);
  });

  it('never chains two different DOIs together through a record without one', () => {
    const published = src({ doi: '10.1/published' });
    const bare = src();
    const preprint = src({ doi: '10.1/preprint' });
    const pairs = findDuplicates([published, bare, preprint]);
    expect(pairs).toHaveLength(1);
    const ids = new Set([pairs[0]?.keepId, pairs[0]?.dropId]);
    expect(ids.has(published.id) && ids.has(preprint.id)).toBe(false);
  });

  it('ignores records that were never identified (no title)', () => {
    expect(findDuplicates([src({ title: null }), src({ title: null })])).toEqual([]);
  });
});

describe('why a source has no full text', () => {
  const base = { status: 'RESOLVED', groundingLevel: 'ABSTRACT', doi: '10.1/a', hasFile: false };

  it('says nothing for a full-text source', () => {
    expect(whyNoFullText({ ...base, groundingLevel: 'FULL_TEXT' })).toBeNull();
  });

  it('names what the record shows, and claims no reason it does not', () => {
    expect(whyNoFullText({ ...base, status: 'PENDING' })).toMatch(/looked up/);
    expect(whyNoFullText({ ...base, status: 'UNRESOLVED' })).toMatch(/could not identify/);
    expect(whyNoFullText({ ...base, hasFile: true })).toMatch(/PDF is attached/);
    expect(whyNoFullText({ ...base, doi: null })).toMatch(/No DOI/);
    expect(whyNoFullText(base)).toMatch(/only the abstract/);
    expect(whyNoFullText({ ...base, groundingLevel: 'NONE' })).toMatch(/no abstract/);
    for (const reason of [whyNoFullText(base), whyNoFullText({ ...base, doi: null })]) {
      expect(reason).not.toMatch(/paywall/i);
    }
  });

  it('R14: says what the last try for an open copy found, and what to do', () => {
    expect(
      whyNoFullText({
        ...base,
        fullTextNote: 'The open-access link led to a page rather than a PDF.',
      }),
    ).toBe(
      'The open-access link led to a page rather than a PDF. No open copy could be fetched, so only the abstract was read. If you have the paper, add its PDF.',
    );
  });
});

describe('repointCitations', () => {
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Wear rises with current ' },
          {
            type: 'citation',
            attrs: {
              key: 'k1',
              sourceId: 'drop',
              chunkId: 'd1',
              role: 'parenthetical',
              locator: 'p. 4',
            },
          },
          { type: 'citation', attrs: { key: 'k2', sourceId: 'other', chunkId: 'o1' } },
        ],
      },
      {
        type: 'draftBlock',
        attrs: { draftId: 'x', status: 'pending' },
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'citation', attrs: { key: 'k3', sourceId: 'drop', chunkId: 'd2' } }],
          },
        ],
      },
    ],
  };

  it('points every citation of the removed record at the kept one, nested ones too', () => {
    const out = repointCitations(doc, 'drop', 'keep', new Map([['d1', 'k-chunk']]));
    expect(out.changed).toBe(2);
    expect(out.passagesCleared).toBe(1);
    const text = JSON.stringify(out.doc);
    expect(text).not.toContain('"drop"');
    // The passage moves when the kept record has the same text, and is cleared when it does not.
    expect(text).toContain('"sourceId":"keep","chunkId":"k-chunk"');
    expect(text).toContain('"key":"k3","sourceId":"keep","chunkId":null');
    // Everything else on the node, and every other citation, is untouched.
    expect(text).toContain('"locator":"p. 4"');
    expect(text).toContain('"sourceId":"other","chunkId":"o1"');
  });

  it('does not change its input, and hands back the same object when nothing cites the record', () => {
    const before = JSON.stringify(doc);
    repointCitations(doc, 'drop', 'keep', new Map());
    expect(JSON.stringify(doc)).toBe(before);
    const none = repointCitations(doc, 'absent', 'keep', new Map());
    expect(none.changed).toBe(0);
    expect(none.doc).toBe(doc);
  });
});
