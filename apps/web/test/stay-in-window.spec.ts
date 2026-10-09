import { describe, expect, it } from 'vitest';
import { EDGE } from '../src/lib/place-menu';
import { shiftIntoWindow } from '../src/lib/stay-in-window';

describe('a dropdown stays inside the window', () => {
  it('moves the thesis card’s More menu back in from the left edge on a phone (QA 2026-10-08)', () => {
    // Measured at 390 px: the menu ran from -41 to 119.
    const shift = shiftIntoWindow({ left: -41, right: 119 }, 390);
    expect(shift).toBe(EDGE + 41);
    expect(-41 + shift).toBe(EDGE);
  });

  it('moves a menu in from the right edge', () => {
    expect(shiftIntoWindow({ left: 300, right: 420 }, 390)).toBe(390 - EDGE - 420);
  });

  it('leaves a menu that fits where it is', () => {
    expect(shiftIntoWindow({ left: 100, right: 260 }, 390)).toBe(0);
    expect(shiftIntoWindow({ left: EDGE, right: 390 - EDGE }, 390)).toBe(0);
  });

  it('lines a menu wider than the window up with the left edge', () => {
    expect(shiftIntoWindow({ left: -100, right: 400 }, 390)).toBe(EDGE + 100);
    expect(shiftIntoWindow({ left: 20, right: 520 }, 390)).toBe(EDGE - 20);
  });
});
