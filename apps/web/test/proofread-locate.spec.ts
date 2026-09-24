import { describe, expect, it } from 'vitest';
import { locateSpan } from '../src/lib/proofread';

describe('placing a correction in the chapter as it is now', () => {
  it('finds the span across the text runs marks split it into', () => {
    // "The farmers recieved it." with "recie" bold: two runs, adjacent positions.
    const runs = [
      { pos: 1, text: 'The farmers ' },
      { pos: 13, text: 'recie' },
      { pos: 18, text: 'ved it.' },
    ];
    expect(locateSpan(runs, 'recieved', 1)).toEqual({ from: 13, to: 21 });
  });

  it('takes the occurrence nearest to where the sentence was read', () => {
    const runs = [
      { pos: 1, text: 'teh first. ' },
      { pos: 40, text: 'Later, teh second.' },
    ];
    expect(locateSpan(runs, 'teh', 44)).toEqual({ from: 47, to: 50 });
    expect(locateSpan(runs, 'teh', 0)).toEqual({ from: 1, to: 4 });
  });

  it('never reaches across a citation, an equation or a paragraph break', () => {
    // "rose sharply" with a citation atom at 6 between the words: positions jump from 6 to 7.
    const runs = [
      { pos: 1, text: 'rose ' },
      { pos: 7, text: 'sharply' },
    ];
    expect(locateSpan(runs, 'rose sharply', 1)).toBeNull();
  });

  it('declines a span that is no longer there, rather than guessing', () => {
    expect(locateSpan([{ pos: 1, text: 'The farmers received it.' }], 'recieved', 1)).toBeNull();
    expect(locateSpan([{ pos: 1, text: 'anything' }], '', 1)).toBeNull();
  });
});
