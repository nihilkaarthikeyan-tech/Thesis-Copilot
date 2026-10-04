/**
 * Journal matching scorer — ADR-0040. The ranking is pure and deterministic, so it is tested
 * exhaustively without a network: a journal ranks high because it matches the thesis subject and
 * already publishes work the thesis cites, and an off-topic venue with no evidence is ruled out.
 */

import { describe, expect, it } from 'vitest';
import {
  JOURNAL_MATCH,
  type JournalCandidate,
  type JournalMatchProfile,
  rankJournals,
  scopeAlignment,
  scoreJournal,
  tokensOf,
} from '../src/journals/score.js';

const journal = (over: Partial<JournalCandidate>): JournalCandidate => ({
  id: 'S1',
  name: 'Journal of Materials Processing Technology',
  issn: ['0924-0136'],
  publisher: 'Elsevier',
  concepts: [
    { name: 'Materials science', level: 0, score: 0.9 },
    { name: 'Electrical discharge machining', level: 3, score: 0.8 },
    { name: 'Machining', level: 2, score: 0.7 },
  ],
  worksCount: 12000,
  meanCitedness: 6.2,
  isOpenAccess: false,
  inDoaj: false,
  apcUsd: null,
  type: 'journal',
  ...over,
});

const profile = (over: Partial<JournalMatchProfile> = {}): JournalMatchProfile => ({
  keywords: ['electrical discharge machining', 'Hastelloy electrodes', 'material removal rate'],
  field: 'Mechanical Engineering',
  citedVenues: {},
  ...over,
});

describe('tokensOf', () => {
  it('drops stop words and short tokens', () => {
    expect(tokensOf('A Study of the Material Removal Rate')).toEqual([
      'material',
      'removal',
      'rate',
    ]);
  });
});

describe('scopeAlignment', () => {
  it('a subfield concept hit scores higher and sets subfield level', () => {
    const r = scopeAlignment(journal({}), profile());
    expect(r.level).toBe('subfield');
    expect(r.points).toBeGreaterThan(JOURNAL_MATCH.scopeFloor);
  });

  it('a journal about nothing in the thesis scores zero, level none', () => {
    const r = scopeAlignment(
      journal({ concepts: [{ name: 'Marine biology', level: 2, score: 0.9 }] }),
      profile(),
    );
    expect(r).toEqual({ points: 0, level: 'none' });
  });
});

describe('scoreJournal', () => {
  it('rewards a journal that publishes the thesis’s own cited sources', () => {
    const withEvidence = scoreJournal(journal({}), profile({ citedVenues: { S1: 3 } }));
    expect(withEvidence.citedHereCount).toBe(3);
    expect(withEvidence.breakdown.citedHere).toBe(3 * JOURNAL_MATCH.pointsPerCitedSource);
    // "Your sources": the count is over the library, cited in the text or not.
    expect(withEvidence.reason).toContain('3 of your sources');
  });

  it('impact tier comes from mean citedness, and unknown scores zero and is never guessed', () => {
    expect(scoreJournal(journal({ meanCitedness: 6.2 }), profile()).impactTier).toBe('high');
    expect(scoreJournal(journal({ meanCitedness: 3 }), profile()).impactTier).toBe('medium');
    expect(scoreJournal(journal({ meanCitedness: 0.5 }), profile()).impactTier).toBe('emerging');
    const unknown = scoreJournal(journal({ meanCitedness: null }), profile());
    expect(unknown.impactTier).toBe('unknown');
    expect(unknown.breakdown.impact).toBe(0);
  });

  it('rules out an off-topic journal with no cited-source evidence (orthogonal gate)', () => {
    const off = scoreJournal(
      journal({ concepts: [{ name: 'Marine biology', level: 2, score: 0.9 }] }),
      profile(),
    );
    expect(off.eligible).toBe(false);
    expect(off.total).toBe(0);
    expect(off.reason).toContain('Off-topic');
  });

  it('keeps an off-topic journal eligible if it actually publishes the thesis’s cited work', () => {
    const r = scoreJournal(
      journal({ id: 'S9', concepts: [{ name: 'Marine biology', level: 2, score: 0.9 }] }),
      profile({ citedVenues: { S9: 2 } }),
    );
    expect(r.eligible).toBe(true);
    // The subjects were compared and differ: "no overlap" is true here.
    expect(r.alignmentLevel).toBe('none');
    expect(r.subjectsCompared).toBe(true);
  });

  it('does not claim "no overlap" for a journal whose subjects OpenAlex did not list', () => {
    const unlisted = scoreJournal(
      journal({ id: 'S9', concepts: [] }),
      profile({ citedVenues: { S9: 1 } }),
    );
    expect(unlisted.eligible).toBe(true);
    expect(unlisted.alignmentLevel).toBe('none');
    expect(unlisted.subjectsCompared).toBe(false);

    const ruledOut = scoreJournal(journal({ concepts: [] }), profile());
    expect(ruledOut.eligible).toBe(false);
    expect(ruledOut.reason).not.toContain('Off-topic');
    expect(ruledOut.reason).toContain('no subjects to compare');
  });

  it('rules out a non-journal venue', () => {
    const repo = scoreJournal(
      journal({ type: 'repository', name: 'arXiv' }),
      profile({ citedVenues: { S1: 5 } }),
    );
    expect(repo.eligible).toBe(false);
    expect(repo.reason).toContain('Not a journal');
  });

  it('flags over-budget without removing the journal', () => {
    const r = scoreJournal(
      journal({ isOpenAccess: true, apcUsd: 3000 }),
      profile({ maxApcUsd: 2000 }),
    );
    expect(r.overBudget).toBe(true);
    expect(r.eligible).toBe(true);
  });
});

describe('rankJournals', () => {
  it('orders eligible before ineligible, over-budget last among eligible, by score within each', () => {
    const strong = journal({ id: 'S1', meanCitedness: 7 });
    const weak = journal({
      id: 'S2',
      name: 'Minor Machining Letters',
      meanCitedness: 0.4,
      concepts: [{ name: 'Machining', level: 2, score: 0.5 }],
    });
    const pricey = journal({
      id: 'S3',
      name: 'Open EDM',
      isOpenAccess: true,
      apcUsd: 4000,
      meanCitedness: 5,
    });
    const off = journal({
      id: 'S4',
      name: 'Botany Today',
      concepts: [{ name: 'Botany', level: 2, score: 0.9 }],
    });
    const ranked = rankJournals([off, pricey, weak, strong], profile({ maxApcUsd: 1000 }));
    expect(ranked.map((r) => r.journalId)).toEqual(['S1', 'S2', 'S3', 'S4']);
    expect(ranked[0]?.eligible).toBe(true);
    expect(ranked[2]?.overBudget).toBe(true);
    expect(ranked[3]?.eligible).toBe(false);
  });

  it('de-duplicates by journal id', () => {
    const j = journal({});
    expect(rankJournals([j, j, j], profile())).toHaveLength(1);
  });
});
