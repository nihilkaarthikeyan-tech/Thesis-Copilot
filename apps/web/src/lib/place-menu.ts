/**
 * Where a floating menu goes (the block menu, R7 and R26): beside its anchor, moved up or left
 * as far as it takes to stay inside the window, with `EDGE` pixels to spare. A menu taller or
 * wider than the window is pinned to the top-left edge; its own max height and width (in CSS)
 * then make it scroll rather than run off the screen.
 */

/** Space kept between the menu and the window's edges. */
export const EDGE = 8;
/** Space kept between the menu and its grip or block. */
export const GAP = 6;
/** The least height worth giving the menu above or below its block; it scrolls inside that. */
export const MIN_MENU_HEIGHT = 200;

export type MenuPlace = { top: number; left: number; maxHeight?: number };

export function placeMenu(
  anchor: { top: number; right: number },
  size: { width: number; height: number },
  view: { width: number; height: number },
): MenuPlace {
  const top = Math.min(anchor.top, view.height - size.height - EDGE);
  const left = Math.min(anchor.right + GAP, view.width - size.width - EDGE);
  return { top: Math.max(EDGE, top), left: Math.max(EDGE, left) };
}

const overlaps = (
  a: { top: number; left: number; width: number; height: number },
  b: { top: number; bottom: number; left: number; right: number },
) => a.left < b.right && a.left + a.width > b.left && a.top < b.bottom && a.top + a.height > b.top;

/**
 * The block menu, kept off the paragraph it acts on (QA 2026-10-09: at 1024 px it opened on top
 * of the start of its own paragraph and hid the words being checked). In order of preference:
 * beside the grip if that clears the block; left of the grip; below the block; above it; and,
 * when neither has the whole menu's height, on the roomier side with a shorter, scrolling menu.
 * Only when none of that fits (a block taller than the window, say) does it fall back to
 * `placeMenu`. Always inside the window.
 */
export function placeBlockMenu(
  grip: { top: number; left: number; right: number },
  block: { top: number; bottom: number; left: number; right: number },
  size: { width: number; height: number },
  view: { width: number; height: number },
): MenuPlace {
  const beside = placeMenu(grip, size, view);
  if (!overlaps({ ...beside, ...size }, block)) return beside;

  const leftOfGrip = grip.left - GAP - size.width;
  if (leftOfGrip >= EDGE) {
    const top = Math.max(EDGE, Math.min(grip.top, view.height - size.height - EDGE));
    if (!overlaps({ top, left: leftOfGrip, ...size }, block)) return { top, left: leftOfGrip };
  }

  const left = Math.max(EDGE, Math.min(block.left, view.width - size.width - EDGE));
  const below = block.bottom + GAP;
  const spaceBelow = view.height - EDGE - below;
  const spaceAbove = block.top - GAP - EDGE;
  if (spaceBelow >= size.height) return { top: below, left };
  if (spaceAbove >= size.height) return { top: block.top - GAP - size.height, left };

  const room = Math.max(spaceBelow, spaceAbove);
  if (room >= MIN_MENU_HEIGHT) {
    return spaceBelow >= spaceAbove
      ? { top: below, left, maxHeight: spaceBelow }
      : { top: EDGE, left, maxHeight: spaceAbove };
  }
  return beside;
}
