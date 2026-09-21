/**
 * Reference health.
 *
 * The severity ordering carries most of the meaning here: a retracted paper and a missing DOI are
 * both "findings", and treating them the same would bury the one that matters. Several of these
 * tests are really about that ranking rather than about detection.
 */

import { describe, expect, it } from 'vitest';
import {
  normaliseTitle,
  referenceHealthHeadline,
  runReferenceHealth,
  type SourceForHealth,
  STALE_PREPRINT_YEARS,
} from '../src/reference-health.js';

const NOW = new Date('2026-09-21T00:00:00Z');

const source = (over: Partial<SourceForHealth> & { id: string }): SourceForHealth => ({
  title: 'A perfectly ordinary paper',
  doi: '10.1234/ok',
  year: 2024,
  status: 'RESOLVED',
  isPreprint: false,
  isRetracted: false,
  shortRef: 'Kumar 2024',
  citeCount: 1,
  ...over,
});

const kinds = (findings: ReturnType<typeof runReferenceHealth>) => findings.map((f) => f.kind);

describe('a healthy library', () => {
  it('reports nothing at all', () => {
    expect(
      runReferenceHealth(
        [source({ id: 'a' }), source({ id: 'b', doi: '10.1/b', title: 'Another' })],
        NOW,
      ),
    ).toEqual([]);
  });

  it('has no headline to show', () => {
    expect(referenceHealthHeadline([])).toBeNull();
  });
});

describe('retracted work', () => {
  it('is reported as high severity even when nothing cites it yet', () => {
    const found = runReferenceHealth([source({ id: 'r', isRetracted: true, citeCount: 0 })], NOW);
    expect(found[0]?.kind).toBe('RETRACTED');
    expect(found[0]?.severity).toBe('high');
  });

  it('says how many times it is cited, because that changes what to do', () => {
    const found = runReferenceHealth([source({ id: 'r', isRetracted: true, citeCount: 3 })], NOW);
    expect(found[0]?.message).toContain('3 times');
  });

  it('outranks everything else in the list', () => {
    const found = runReferenceHealth(
      [
        source({ id: 'nodoi', doi: null }),
        source({ id: 'retracted', doi: '10.2/x', title: 'Other', isRetracted: true }),
      ],
      NOW,
    );
    expect(found[0]?.kind).toBe('RETRACTED');
  });
});

describe('preprints that have aged', () => {
  it('says nothing about a recent one', () => {
    const found = runReferenceHealth([source({ id: 'p', isPreprint: true, year: 2026 })], NOW);
    expect(kinds(found)).not.toContain('STALE_PREPRINT');
  });

  it('flags one old enough to have been published', () => {
    const old = 2026 - STALE_PREPRINT_YEARS;
    const found = runReferenceHealth([source({ id: 'p', isPreprint: true, year: old })], NOW);
    expect(kinds(found)).toContain('STALE_PREPRINT');
    expect(found[0]?.message).toContain(String(old));
  });

  it('matters less when nothing cites it', () => {
    const old = 2020;
    const cited = runReferenceHealth([source({ id: 'p', isPreprint: true, year: old })], NOW);
    const uncited = runReferenceHealth(
      [source({ id: 'p', isPreprint: true, year: old, citeCount: 0 })],
      NOW,
    );
    expect(cited[0]?.severity).toBe('medium');
    expect(uncited[0]?.severity).toBe('low');
  });
});

describe('duplicates', () => {
  it('catches the same DOI twice', () => {
    const found = runReferenceHealth(
      [source({ id: 'a' }), source({ id: 'b', title: 'Typed differently' })],
      NOW,
    );
    expect(kinds(found)).toContain('DUPLICATE');
    expect(found.find((f) => f.kind === 'DUPLICATE')?.otherSourceId).toBe('a');
  });

  it('catches the same title and year under different punctuation', () => {
    const found = runReferenceHealth(
      [
        source({ id: 'a', doi: null, title: 'Solar rooftop in India: policies and outlook' }),
        source({ id: 'b', doi: null, title: 'Solar Rooftop in India — Policies and Outlook' }),
      ],
      NOW,
    );
    expect(kinds(found)).toContain('DUPLICATE');
  });

  it('does not call a follow-up paper a duplicate', () => {
    // Same title, different year: far more likely two papers than one entered twice.
    const found = runReferenceHealth(
      [
        source({ id: 'a', doi: null, title: 'Annual survey of adoption', year: 2023 }),
        source({ id: 'b', doi: null, title: 'Annual survey of adoption', year: 2024 }),
      ],
      NOW,
    );
    expect(kinds(found)).not.toContain('DUPLICATE');
  });

  it('reports a pair once, not once from each side', () => {
    const found = runReferenceHealth(
      [source({ id: 'a' }), source({ id: 'b', title: 'Other wording' })],
      NOW,
    );
    expect(found.filter((f) => f.kind === 'DUPLICATE')).toHaveLength(1);
  });
});

describe('references we could not verify', () => {
  it('is high severity when the thesis cites it', () => {
    const found = runReferenceHealth([source({ id: 'u', status: 'UNRESOLVED' })], NOW);
    expect(found[0]?.kind).toBe('UNRESOLVED');
    expect(found[0]?.severity).toBe('high');
  });

  it('does not also complain that it has no DOI', () => {
    // One problem, one finding: an unresolved record having no DOI is the same fact.
    const found = runReferenceHealth([source({ id: 'u', status: 'UNRESOLVED', doi: null })], NOW);
    expect(kinds(found)).toEqual(['UNRESOLVED']);
  });
});

describe('missing identifiers', () => {
  it('is mentioned for a cited source', () => {
    expect(kinds(runReferenceHealth([source({ id: 'n', doi: null })], NOW))).toContain(
      'NO_IDENTIFIER',
    );
  });

  it('is not worth mentioning for one nothing cites', () => {
    const found = runReferenceHealth([source({ id: 'n', doi: null, citeCount: 0 })], NOW);
    expect(kinds(found)).not.toContain('NO_IDENTIFIER');
  });
});

describe('normalising a title', () => {
  it('ignores case, punctuation and spacing', () => {
    expect(normaliseTitle('Solar  Rooftop: Policies!')).toBe('solar rooftop policies');
  });
});

describe('the headline', () => {
  it('leads with the serious ones when there are any', () => {
    const found = runReferenceHealth([source({ id: 'r', isRetracted: true })], NOW);
    expect(referenceHealthHeadline(found)).toContain('examiner');
  });

  it('is calm when everything is housekeeping', () => {
    const found = runReferenceHealth([source({ id: 'n', doi: null })], NOW);
    expect(referenceHealthHeadline(found)).toContain('tidying');
  });
});
