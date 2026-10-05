'use client';

/**
 * What a passage selected in the reader can become (ADR-0068): copied with its citation, cited in
 * the chapter, or asked about in chat. A small menu over the selection with a mouse; a bar along
 * the foot of the screen on a touch screen, where the phone's own copy/select menu sits over the
 * selection and a second menu there would fight it.
 *
 * The selection is captured the moment it is made. On a phone, tapping a button collapses the
 * selection before the tap arrives, so the menu acts on what was captured, not on what is left.
 */

import { type RefObject, useEffect, useRef, useState } from 'react';
import { cleanPassage } from '@/lib/reader';

export type Selected = {
  text: string;
  /** The page the selection starts on, when the view knows it. */
  page: number | null;
  /** The passage (chunk) it came from — the Text view knows; the PDF view does not. */
  chunkId: string | null;
};

export function SelectionMenu({
  container,
  onCopy,
  onCite,
  onAsk,
  busy,
}: {
  container: RefObject<HTMLElement | null>;
  onCopy: (selected: Selected) => void;
  onCite: (selected: Selected) => void;
  onAsk: (selected: Selected) => void;
  busy?: boolean;
}) {
  const [selected, setSelected] = useState<Selected | null>(null);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const [coarse, setCoarse] = useState(false);
  const pressing = useRef(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const query = window.matchMedia('(pointer: coarse)');
    setCoarse(query.matches);
    const onChange = () => setCoarse(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    let frame = 0;
    const read = () => {
      const root = container.current;
      const selection = window.getSelection();
      const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      const inside = !!range && !!root && root.contains(range.commonAncestorContainer);
      const text = inside && selection ? cleanPassage(selection.toString()) : '';
      if (!range || !inside || text.length < 2) {
        // Not at once: a tap on the menu collapses the selection before the tap lands.
        if (hideTimer.current || pressing.current) return;
        hideTimer.current = setTimeout(() => {
          hideTimer.current = null;
          if (!pressing.current) {
            setSelected(null);
            setAnchor(null);
          }
        }, 300);
        return;
      }
      if (hideTimer.current) {
        clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }
      const start =
        range.startContainer.nodeType === Node.ELEMENT_NODE
          ? (range.startContainer as Element)
          : range.startContainer.parentElement;
      const pageAttr = start?.closest('[data-page]')?.getAttribute('data-page');
      const page = pageAttr ? Number(pageAttr) : null;
      const chunkId = start?.closest('[data-chunk-id]')?.getAttribute('data-chunk-id') ?? null;
      setSelected({ text, page: Number.isFinite(page) ? page : null, chunkId });
      const box = range.getBoundingClientRect();
      setAnchor({ top: box.top, left: box.left + box.width / 2 });
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(read);
    };
    document.addEventListener('selectionchange', schedule);
    // A scroll moves the selection out from under a menu placed over it.
    const root = container.current;
    const onScroll = () => {
      if (!coarse) schedule();
    };
    root?.addEventListener('scroll', onScroll, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('selectionchange', schedule);
      root?.removeEventListener('scroll', onScroll, true);
    };
  }, [container, coarse]);

  if (!selected || !anchor) return null;

  const act = (fn: (s: Selected) => void) => () => {
    pressing.current = false;
    fn(selected);
    setSelected(null);
    setAnchor(null);
  };
  const hold = {
    // Keeps the selection (and the menu) through the press on a desktop.
    onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
    onPointerDown: () => {
      pressing.current = true;
    },
  };
  const button =
    'whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13px] font-semibold text-ink transition-colors hover:bg-sunk disabled:opacity-50';

  const buttons = (
    <>
      <button
        type="button"
        data-testid="reader-copy-cite"
        disabled={busy}
        className={button}
        {...hold}
        onClick={act(onCopy)}
      >
        Copy with citation
      </button>
      <button
        type="button"
        data-testid="reader-cite"
        className={button}
        {...hold}
        onClick={act(onCite)}
      >
        Cite in my chapter
      </button>
      <button
        type="button"
        data-testid="reader-ask"
        className={button}
        {...hold}
        onClick={act(onAsk)}
      >
        Ask chat about this
      </button>
    </>
  );

  if (coarse) {
    return (
      <div
        role="toolbar"
        aria-label="Use the selected passage"
        data-testid="reader-selection-menu"
        className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-3 gap-1 border-t border-line bg-surface px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-lg [&>button]:whitespace-normal [&>button]:leading-tight"
      >
        {buttons}
      </div>
    );
  }

  const width = 420;
  const left = Math.min(Math.max(8, anchor.left - width / 2), window.innerWidth - width - 8);
  const top = anchor.top > 64 ? anchor.top - 48 : anchor.top + 28;
  return (
    <div
      role="toolbar"
      aria-label="Use the selected passage"
      data-testid="reader-selection-menu"
      className="fixed z-50 flex gap-0.5 rounded-lg border border-line bg-surface p-1 shadow-lg"
      style={{ top, left: Math.max(8, left) }}
    >
      {buttons}
    </div>
  );
}
