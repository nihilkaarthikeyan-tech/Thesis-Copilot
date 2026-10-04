/**
 * The source badges' wording (coverage map rows 21, 32, 46). A badge appears only for a fact that
 * was fetched: absent and null show nothing, and a closed paper gets no "Closed" badge.
 */

import { describe, expect, it } from 'vitest';
import { sourceMetricBadges } from '../src/editor/source-metrics.js';

describe('sourceMetricBadges', () => {
  it('words all three in a fixed order', () => {
    const badges = sourceMetricBadges({
      citedByCount: 85363,
      openAccess: true,
      oaStatus: 'green',
      journalCitedness: 18.06,
    });
    expect(badges.map((b) => b.label)).toEqual([
      'Cited by 85,363',
      'Open access',
      'Journal citedness 18.1',
    ]);
    expect(badges[1]?.title).toBe('Free to read: a free copy in a repository.');
    expect(badges[2]?.title).toMatch(/^Mean citations per paper for this journal over two years/);
    expect(badges[2]?.title).not.toMatch(/is an impact factor/i);
  });

  it('shows nothing it was not given', () => {
    expect(sourceMetricBadges({})).toEqual([]);
    expect(
      sourceMetricBadges({ citedByCount: null, openAccess: null, journalCitedness: null }),
    ).toEqual([]);
    expect(sourceMetricBadges({ openAccess: false, oaStatus: 'closed' })).toEqual([]);
  });

  it('a fetched zero is still a fact', () => {
    expect(sourceMetricBadges({ citedByCount: 0 }).map((b) => b.label)).toEqual(['Cited by 0']);
    expect(sourceMetricBadges({ journalCitedness: 0 }).map((b) => b.label)).toEqual([
      'Journal citedness 0.0',
    ]);
  });

  it('an unknown route still says free to read, without inventing one', () => {
    expect(sourceMetricBadges({ openAccess: true, oaStatus: 'open' })[0]?.title).toBe(
      'Free to read.',
    );
  });
});
