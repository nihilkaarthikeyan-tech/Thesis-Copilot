/**
 * A dropdown anchored to one side of its button (`absolute right-0`) stays inside the window.
 *
 * QA 2026-10-08: the thesis card's "More" menu, `right-0` against its button, opened from -41 px
 * to 119 px at 390 px wide: on a phone the card's links wrap and "More" lands on the left of the
 * second row, so a menu lined up with its right edge runs off the left of the screen. Where the
 * button lands depends on how its row wrapped, so the menu is measured once it is open and moved
 * sideways by just as much as it takes, with `EDGE` pixels to spare.
 */

import { type CSSProperties, type RefObject, useLayoutEffect, useRef, useState } from 'react';
import { EDGE } from './place-menu';

/**
 * How far to move a box sideways so it lies within `0..width`, with `edge` to spare: 0 when it
 * already fits. A box wider than the window is lined up with the left edge (its own max-width
 * then keeps it from running off the right).
 */
export function shiftIntoWindow(
  box: { left: number; right: number },
  width: number,
  edge = EDGE,
): number {
  if (box.right - box.left > width - 2 * edge) return edge - box.left;
  if (box.left < edge) return edge - box.left;
  if (box.right > width - edge) return width - edge - box.right;
  return 0;
}

/**
 * Measures the menu in `ref` while `open`, and on a resize, and returns the style that keeps it
 * inside the window. Put the ref and the style on the absolutely positioned menu.
 */
export function useStayInWindow<T extends HTMLElement>(
  open: boolean,
): { ref: RefObject<T | null>; style: CSSProperties | undefined } {
  const ref = useRef<T | null>(null);
  const [shift, setShift] = useState(0);
  const current = useRef(0);

  useLayoutEffect(() => {
    if (!open) {
      current.current = 0;
      setShift(0);
      return;
    }
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      const box = el.getBoundingClientRect();
      // The box as it would sit unmoved, so a resize measures from where CSS put it.
      const unmoved = { left: box.left - current.current, right: box.right - current.current };
      const next = shiftIntoWindow(unmoved, document.documentElement.clientWidth);
      current.current = next;
      setShift(next);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open]);

  return { ref, style: shift ? { transform: `translateX(${shift}px)` } : undefined };
}
