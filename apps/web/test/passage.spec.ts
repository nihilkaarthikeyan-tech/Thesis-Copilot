import { describe, expect, it } from 'vitest';
import { passageRuns } from '../src/lib/passage';

const text = 'Residential rooftop solar adoption is considered crucial.';

describe('cutting a passage into plain and marked runs', () => {
  it('marks the highlighted words and keeps every character', () => {
    const runs = passageRuns({
      text,
      highlights: [
        { start: 12, end: 19 },
        { start: 20, end: 25 },
      ],
    });
    expect(runs).toEqual([
      { text: 'Residential ', match: false },
      { text: 'rooftop', match: true },
      { text: ' ', match: false },
      { text: 'solar', match: true },
      { text: ' adoption is considered crucial.', match: false },
    ]);
    expect(runs.map((r) => r.text).join('')).toBe(text);
  });

  it('is one plain run with nothing highlighted', () => {
    expect(passageRuns({ text, highlights: [] })).toEqual([{ text, match: false }]);
  });

  it('ignores a range that overlaps, is empty or runs past the end', () => {
    const runs = passageRuns({
      text,
      highlights: [
        { start: 12, end: 19 },
        { start: 15, end: 22 },
        { start: 30, end: 30 },
        { start: 50, end: 999 },
      ],
    });
    expect(runs.filter((r) => r.match).map((r) => r.text)).toEqual(['rooftop']);
    expect(runs.map((r) => r.text).join('')).toBe(text);
  });
});
