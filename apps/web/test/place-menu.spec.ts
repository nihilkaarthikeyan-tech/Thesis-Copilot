/**
 * The block menu stays inside the window (R26, ADR-0126): at every width the owner checks, with a
 * submenu open, the menu's four edges are inside the window.
 */

import { describe, expect, it } from 'vitest';
import { EDGE, placeBlockMenu, placeMenu } from '../src/lib/place-menu.js';

const WIDTHS = [1440, 1280, 1024, 768, 390];
/** The menu's width (w-60) and its height closed and with the longest submenu open. */
const MENU = { width: 240, closed: 420, open: 640 };

describe('placeMenu', () => {
  it('sits beside the grip when there is room', () => {
    expect(
      placeMenu(
        { top: 200, right: 300 },
        { width: 240, height: 420 },
        { width: 1440, height: 900 },
      ),
    ).toEqual({ top: 200, left: 306 });
  });

  for (const width of WIDTHS) {
    for (const height of [900, 700, 560]) {
      it(`fits inside ${width} x ${height}, from a grip anywhere`, () => {
        for (const menuHeight of [MENU.closed, MENU.open]) {
          // CSS caps the menu at the window less the edges; taller than that, it scrolls.
          const shown = Math.min(menuHeight, height - 2 * EDGE);
          const size = { width: Math.min(MENU.width, width - 2 * EDGE), height: shown };
          for (const top of [0, height / 2, height - 20]) {
            for (const right of [40, width / 2, width - 10]) {
              const at = placeMenu({ top, right }, size, { width, height });
              expect(at.top).toBeGreaterThanOrEqual(EDGE);
              expect(at.left).toBeGreaterThanOrEqual(EDGE);
              expect(at.top + size.height).toBeLessThanOrEqual(height - EDGE);
              expect(at.left + size.width).toBeLessThanOrEqual(width - EDGE);
            }
          }
        }
      });
    }
  }
});

describe('placeBlockMenu (QA 2026-10-09: the menu keeps off its own paragraph)', () => {
  type Box = { top: number; bottom: number; left: number; right: number };
  const overlaps = (
    at: { top: number; left: number },
    size: { width: number; height: number },
    b: Box,
  ) =>
    at.left < b.right &&
    at.left + size.width > b.left &&
    at.top < b.bottom &&
    at.top + size.height > b.top;

  it('at 1024 px, with no room left of the grip, it goes below the paragraph, not over it', () => {
    const grip = { top: 300, left: 236, right: 260 };
    const block = { top: 296, bottom: 380, left: 268, right: 1000 };
    const size = { width: 240, height: 420 };
    const view = { width: 1024, height: 768 };
    // The old placement: beside the grip, on top of the paragraph's first words.
    expect(overlaps(placeMenu(grip, size, view), size, block)).toBe(true);
    const at = placeBlockMenu(grip, block, size, view);
    const shown = { width: size.width, height: at.maxHeight ?? size.height };
    expect(overlaps(at, shown, block)).toBe(false);
    expect(at.top).toBeGreaterThan(block.bottom);
    expect(at.top + shown.height).toBeLessThanOrEqual(view.height - EDGE);
  });

  it('left of the grip when the margin has room for it', () => {
    const at = placeBlockMenu(
      { top: 300, left: 400, right: 424 },
      { top: 296, bottom: 380, left: 432, right: 1100 },
      { width: 240, height: 420 },
      { width: 1440, height: 900 },
    );
    expect(at).toEqual({ top: 300, left: 400 - 6 - 240 });
  });

  it('above the paragraph when it is near the bottom of the window', () => {
    const block = { top: 640, bottom: 700, left: 268, right: 1000 };
    const at = placeBlockMenu(
      { top: 644, left: 236, right: 260 },
      block,
      { width: 240, height: 420 },
      { width: 1024, height: 768 },
    );
    expect(at.top + 420).toBeLessThanOrEqual(block.top);
    expect(at.top).toBeGreaterThanOrEqual(EDGE);
  });

  for (const width of [1440, 1280, 1024, 768, 390]) {
    for (const height of [900, 768, 560]) {
      it(`is inside ${width} x ${height} and off the block whenever there is room`, () => {
        const size = {
          width: Math.min(240, width - 2 * EDGE),
          height: Math.min(420, height - 2 * EDGE),
        };
        const gripLeft = width < 768 ? 4 : width < 1024 ? 236 : 260;
        for (const top of [EDGE, height / 3, height / 2, height - 80]) {
          for (const tall of [24, 90, 200]) {
            const block = { top, bottom: top + tall, left: gripLeft + 32, right: width - 24 };
            const grip = { top: top + 4, left: gripLeft, right: gripLeft + 24 };
            const at = placeBlockMenu(grip, block, size, { width, height });
            const shown = { width: size.width, height: at.maxHeight ?? size.height };
            expect(at.top).toBeGreaterThanOrEqual(EDGE);
            expect(at.left).toBeGreaterThanOrEqual(EDGE);
            expect(at.top + shown.height).toBeLessThanOrEqual(height - EDGE);
            expect(at.left + shown.width).toBeLessThanOrEqual(width - EDGE);
            const above = block.top - 6 - EDGE;
            const below = height - EDGE - block.bottom - 6;
            if (Math.max(above, below) >= 200) expect(overlaps(at, shown, block)).toBe(false);
          }
        }
      });
    }
  }
});
