import { describe, expect, it } from 'vitest';
import { isOnBackdrop } from '../src/lib/dialog-backdrop';

const box = { left: 100, top: 50, right: 612, bottom: 450 };

describe('isOnBackdrop (QA 2026-10-09: a click on the dim backdrop closes a dialog)', () => {
  it('is the backdrop when the dialog is the target and the point is outside its box', () => {
    expect(isOnBackdrop(true, box, { x: 20, y: 200 })).toBe(true);
    expect(isOnBackdrop(true, box, { x: 700, y: 200 })).toBe(true);
    expect(isOnBackdrop(true, box, { x: 300, y: 10 })).toBe(true);
    expect(isOnBackdrop(true, box, { x: 300, y: 500 })).toBe(true);
  });

  it('is not the backdrop inside the box, e.g. the dialog’s own scrollbar', () => {
    expect(isOnBackdrop(true, box, { x: 605, y: 200 })).toBe(false);
    expect(isOnBackdrop(true, box, { x: 100, y: 50 })).toBe(false);
  });

  it('is never the backdrop when the target is something inside the dialog', () => {
    expect(isOnBackdrop(false, box, { x: 20, y: 200 })).toBe(false);
    expect(isOnBackdrop(false, box, { x: 300, y: 200 })).toBe(false);
  });
});
