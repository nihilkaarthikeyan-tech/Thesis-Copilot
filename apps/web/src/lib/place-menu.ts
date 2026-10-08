/**
 * Where a floating menu goes (the block menu, R7 and R26): beside its anchor, moved up or left
 * as far as it takes to stay inside the window, with `EDGE` pixels to spare. A menu taller or
 * wider than the window is pinned to the top-left edge; its own max height and width (in CSS)
 * then make it scroll rather than run off the screen.
 */

/** Space kept between the menu and the window's edges. */
export const EDGE = 8;

export function placeMenu(
  anchor: { top: number; right: number },
  size: { width: number; height: number },
  view: { width: number; height: number },
): { top: number; left: number } {
  const top = Math.min(anchor.top, view.height - size.height - EDGE);
  const left = Math.min(anchor.right + 6, view.width - size.width - EDGE);
  return { top: Math.max(EDGE, top), left: Math.max(EDGE, left) };
}
