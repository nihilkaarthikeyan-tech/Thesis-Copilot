import { describe, expect, it } from 'vitest';
import { barTone } from '../src/lib/usage';

describe('usage bars (Jenni build plan R12)', () => {
  it('are green with plenty left, amber from three quarters, red when used up', () => {
    expect(barTone(0, 50)).toBe('ok');
    expect(barTone(37, 50)).toBe('ok');
    expect(barTone(38, 50)).toBe('low');
    expect(barTone(50, 50)).toBe('out');
    expect(barTone(3, 2)).toBe('out');
    // An allowance with nothing in it is used up, not empty and green.
    expect(barTone(0, 0)).toBe('out');
  });
});
