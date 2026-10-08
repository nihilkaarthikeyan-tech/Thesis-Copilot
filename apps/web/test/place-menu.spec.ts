/**
 * The block menu stays inside the window (R26, ADR-0126): at every width the owner checks, with a
 * submenu open, the menu's four edges are inside the window.
 */

import { describe, expect, it } from 'vitest';
import { EDGE, placeMenu } from '../src/lib/place-menu.js';

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
