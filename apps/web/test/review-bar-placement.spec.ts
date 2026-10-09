import { describe, expect, it } from 'vitest';
import { REVIEW_BAR_MAX, reviewBarPlacement } from '../src/lib/review-mode';

/** The bar's box must sit inside the column, a gutter in from each edge. */
function inside(column: { left: number; right: number }, viewport: number) {
  const bar = reviewBarPlacement(column, viewport);
  expect(bar.left).toBeGreaterThanOrEqual(column.left + 16);
  expect(bar.left + bar.width).toBeLessThanOrEqual(column.right - 16);
  expect(bar.width).toBeLessThanOrEqual(REVIEW_BAR_MAX);
  return bar;
}

describe('reviewBarPlacement (QA 2026-10-09: the review bar stays off the tool panel)', () => {
  it('at 1280 px it is centred over the writing column and ends before the panel at 992', () => {
    // Chapter rail 224 px, tool panel 288 px: the column is 224–992.
    const bar = inside({ left: 224, right: 992 }, 1280);
    expect(bar.left + bar.width).toBeLessThanOrEqual(992 - 16);
    expect(bar.left + bar.width / 2).toBe((224 + 992) / 2);
  });

  it('at 1024 px, the narrowest width with the panel beside the text', () => {
    const bar = inside({ left: 224, right: 736 }, 1024);
    expect(bar.width).toBe(512 - 32);
  });

  it('on a wide screen it keeps its 46rem and is centred on the column', () => {
    const bar = inside({ left: 224, right: 1632 }, 1920);
    expect(bar.width).toBe(REVIEW_BAR_MAX);
    expect(bar.left + bar.width / 2).toBe((224 + 1632) / 2);
  });

  it('beside an open "read beside" pane it moves with the column', () => {
    inside({ left: 224, right: 900 }, 1600);
  });

  it('on a phone the column is the window, a gutter each side', () => {
    const bar = inside({ left: 0, right: 390 }, 390);
    expect(bar).toEqual({ left: 16, width: 358 });
  });

  it('a column too narrow for the bar falls back to the window, still inside it', () => {
    const bar = reviewBarPlacement({ left: 300, right: 500 }, 800);
    expect(bar.left).toBeGreaterThanOrEqual(16);
    expect(bar.left + bar.width).toBeLessThanOrEqual(800 - 16);
  });
});
