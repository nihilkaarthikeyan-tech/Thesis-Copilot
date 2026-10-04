/**
 * The sentence a merge leaves on the Sources screen. It is the student's only account of what
 * moved, so it must name every change and say plainly when a citation lost its passage.
 */

import { describe, expect, it } from 'vitest';
import { mergeSummary } from '../src/lib/library-issues';

const none = { citationsMoved: 0, passagesCleared: 0, pinsMoved: 0, fileMoved: false };

describe('mergeSummary', () => {
  it('says so when nothing cited the copy', () => {
    expect(mergeSummary(none)).toBe('Merged. Nothing cited the copy.');
  });

  it('names every move, with the right number and verb', () => {
    const text = mergeSummary({ ...none, citationsMoved: 1, pinsMoved: 2, fileMoved: true });
    expect(text).toContain('1 citation now points at the kept copy');
    expect(text).toContain('2 chapter pins moved');
    expect(text).toContain('its PDF moved across');
    expect(text).toContain('in History');
  });

  it('owns up to a citation that no longer opens at a passage', () => {
    const text = mergeSummary({ ...none, citationsMoved: 3, passagesCleared: 2 });
    expect(text).toContain('3 citations now point');
    expect(text).toContain('2 citations no longer open at a passage');
    expect(text).toContain('the citation itself is unchanged');
  });
});
