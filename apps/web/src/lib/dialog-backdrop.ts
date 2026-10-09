/**
 * Whether a pointer event on a native `<dialog>` landed on its dim backdrop.
 *
 * A click on `::backdrop` is reported with the `<dialog>` itself as the target, and so is a click
 * on the dialog's own scrollbar or padding; only the coordinates tell the two apart. A point
 * outside the dialog's box is the backdrop. The caller also requires the press to have *started*
 * there, so a text selection dragged out of the dialog does not close it.
 */
export function isOnBackdrop(
  targetIsDialog: boolean,
  box: { left: number; top: number; right: number; bottom: number },
  point: { x: number; y: number },
): boolean {
  if (!targetIsDialog) return false;
  return point.x < box.left || point.x > box.right || point.y < box.top || point.y > box.bottom;
}
