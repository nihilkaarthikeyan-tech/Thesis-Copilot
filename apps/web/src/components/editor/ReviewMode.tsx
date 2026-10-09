'use client';

/**
 * Review mode (Jenni build plan R23, ADR-0110): a check's results walked through in the text.
 *
 * Jenni opens a review as tracked changes with a bar — Resume editing (Esc), Reject all, Accept
 * all, ↑ 1/3 ↓, Reject (N), Accept (Y) — and at the end "All suggestions resolved!" with the next
 * check to try. Our proofreading and tone review listed their corrections in the side panel, and
 * the flags only had Go to. A panel now hands its list here (`startReview`); this draws each item
 * in the chapter (`TrackedChanges`, `@tc/ui`) and the student decides each one.
 *
 * Flag, don't fix: nothing changes until the student presses Accept (or Y) on a change they can
 * see. An accepted change is written with `COMMAND` provenance, as the panel's own Accept writes
 * it. Accept all is one step, so one Undo takes it back. While the review is open the chapter is
 * read-only — Y and N are letters — and Esc gives the keyboard back; whatever is left stays in the
 * panel's list.
 */

import { type TrackedChangesStorage, trackedChangeRange, trackedChangesKey } from '@tc/ui';
import type { Editor } from '@tiptap/core';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  applicableInOrder,
  REVIEW_START,
  type ReviewItem,
  type ReviewSession,
  reviewBarPlacement,
} from '@/lib/review-mode';

function storageOf(editor: Editor): TrackedChangesStorage | undefined {
  return (editor.storage as unknown as { trackedChanges?: TrackedChangesStorage }).trackedChanges;
}

function scrollTo(editor: Editor, id: string) {
  // After the decorations are drawn.
  window.setTimeout(() => {
    editor.view.dom
      .querySelector(`[data-change-id="${CSS.escape(id)}"]`)
      // A jump, not a smooth scroll: Y pressed twice in a row must land on the second change.
      ?.scrollIntoView({ block: 'center' });
  }, 0);
}

function short(text: string, max = 80): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function ReviewMode({
  editor,
  onStart,
  onShowChecks,
}: {
  editor: Editor | null;
  /** The review is in the text: on a phone, the side drawer that started it has to close. */
  onStart?: () => void;
  /** "Try next": the Check tab, open, so the next check's button can take the keyboard. */
  onShowChecks?: () => void;
}) {
  // Read at call time: the editor screen passes new functions on every render.
  const callbacks = useRef({ onStart, onShowChecks });
  callbacks.current = { onStart, onShowChecks };
  const [session, setSession] = useState<ReviewSession | null>(null);
  /** The items in reading order, as the review started; decided ones are dropped. */
  const [order, setOrder] = useState<ReviewItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [decided, setDecided] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [busy, setBusy] = useState(false);
  const wasEditable = useRef(true);
  // The plugin's state changes with every transaction (a change mapped, marked gone).
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  // QA 2026-10-09: the bar sits over the writing column, not the middle of the window, so it
  // stays off the tool panel and the "read beside" pane at every width (`reviewBarPlacement`).
  const [placement, setPlacement] = useState<{ left: number; width: number } | null>(null);
  useEffect(() => {
    if (!session || !editor) return;
    let column: HTMLElement | null = null;
    try {
      column = editor.view.dom.closest('main');
    } catch {
      // The view is not mounted yet: the CSS placement stands.
    }
    if (!column) return;
    const place = () => {
      const box = column.getBoundingClientRect();
      setPlacement(reviewBarPlacement(box, document.documentElement.clientWidth));
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(column);
    window.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [session, editor]);

  /** The items still drawn in the text: not decided, and their words still there. */
  const live = useCallback((): ReviewItem[] => {
    if (!editor) return [];
    const state = trackedChangesKey.getState(editor.state);
    const drawn = new Set(state?.changes.filter((c) => !c.gone).map((c) => c.id));
    return order.filter((item) => drawn.has(item.id));
  }, [editor, order]);

  const activate = useCallback(
    (id: string | null) => {
      setActiveId(id);
      if (!editor) return;
      editor.commands.setActiveTrackedChange(id);
      if (id) scrollTo(editor, id);
    },
    [editor],
  );

  const exit = useCallback(() => {
    if (editor && !editor.isDestroyed) {
      editor.commands.clearTrackedChanges();
      editor.setEditable(wasEditable.current, false);
      const storage = storageOf(editor);
      if (storage) storage.onPick = null;
    }
    setSession(null);
    setOrder([]);
    setActiveId(null);
  }, [editor]);

  // A panel asks for a review.
  useEffect(() => {
    if (!editor) return;
    const onStart = (event: Event) => {
      const next = (event as CustomEvent<ReviewSession>).detail;
      if (!next || editor.isDestroyed) return;
      const items = [...next.items].sort((a, b) => a.from - b.from);
      if (!trackedChangesKey.getState(editor.state)?.changes.length) {
        wasEditable.current = editor.isEditable;
      }
      editor.setEditable(false, false);
      editor.commands.setTrackedChanges(
        items.map(({ id, from, to, original, replacement }) => ({
          id,
          from,
          to,
          original,
          replacement,
        })),
      );
      const state = trackedChangesKey.getState(editor.state);
      const placed = items.filter((i) => state?.changes.some((c) => c.id === i.id && !c.gone));
      setSkipped(items.length - placed.length);
      setDecided(0);
      setOrder(items);
      setSession(next);
      const storage = storageOf(editor);
      if (storage) storage.onPick = (id) => activate(id);
      callbacks.current.onStart?.();
      activate(placed[0]?.id ?? null);
    };
    window.addEventListener(REVIEW_START, onStart);
    return () => window.removeEventListener(REVIEW_START, onStart);
  }, [editor, activate]);

  // The floating Suggest button on a phone asks for a suggestion in a chapter that is read-only
  // for now, and sits where this bar is; it is hidden while the review is open (editor.css).
  useEffect(() => {
    document.body.classList.toggle('tc-reviewing', Boolean(session));
    return () => document.body.classList.remove('tc-reviewing');
  }, [session]);

  useEffect(() => {
    if (!editor || !session) return;
    editor.on('transaction', redraw);
    return () => {
      editor.off('transaction', redraw);
    };
  }, [editor, session]);

  // A new chapter, or the editor going away, ends the review.
  useEffect(() => {
    return () => {
      if (
        editor &&
        !editor.isDestroyed &&
        trackedChangesKey.getState(editor.state)?.changes.length
      ) {
        editor.commands.clearTrackedChanges();
        editor.setEditable(wasEditable.current, false);
      }
    };
  }, [editor]);

  /** After a decision: the next item on, or the first if that was the last. */
  const moveOn = useCallback(
    (from: string) => {
      const rest = live().filter((i) => i.id !== from);
      const at = order.findIndex((i) => i.id === from);
      const next = rest.find((i) => order.indexOf(i) > at) ?? rest[0] ?? null;
      activate(next?.id ?? null);
    },
    [live, order, activate],
  );

  const decide = useCallback(
    async (id: string, accepted: boolean) => {
      if (!editor || !session || busy) return;
      const item = order.find((i) => i.id === id);
      const now = trackedChangeRange(editor.state, id);
      if (!item || !now) return;
      if (now.gone) {
        // Its words changed under it; nothing to apply. It stays in the panel's list.
        editor.commands.removeTrackedChange(id);
        setSkipped((n) => n + 1);
        moveOn(id);
        return;
      }
      moveOn(id);
      if (accepted && item.replacement !== null) {
        const text = item.replacement;
        let chain = editor.chain().command(({ tr, dispatch }) => {
          if (dispatch) tr.insertText(text, now.from, now.to);
          return true;
        });
        if (text.length > 0) {
          chain = chain.setProvenance(now.from, now.from + text.length, {
            kind: 'COMMAND',
            actionId: null,
          });
        }
        chain.removeTrackedChange(id).run();
      } else {
        editor.commands.removeTrackedChange(id);
      }
      setOrder((list) => list.filter((i) => i.id !== id));
      setDecided((n) => n + 1);
      setBusy(true);
      try {
        await session.decide(id, accepted);
      } finally {
        setBusy(false);
      }
    },
    [editor, session, busy, order, moveOn],
  );

  const decideAll = useCallback(
    async (accepted: boolean) => {
      if (!editor || !session) return;
      const items = live();
      if (items.length === 0) return;
      const placed = items
        .map((item) => ({ item, now: trackedChangeRange(editor.state, item.id) }))
        .filter(
          (p): p is { item: ReviewItem; now: NonNullable<typeof p.now> } =>
            p.now !== null && !p.now.gone,
        );
      let done = placed.map((p) => p.item);
      if (accepted) {
        // Changes in one step, last first so each leaves the positions before it alone; two that
        // overlap leave the second for another pass rather than guess.
        const changes = applicableInOrder(
          placed
            .filter((p) => p.item.replacement !== null)
            .map((p) => ({ ...p, from: p.now.from, to: p.now.to })),
        );
        const notes = placed.filter((p) => p.item.replacement === null);
        let chain = editor.chain();
        for (const { item, from, to } of changes) {
          const text = item.replacement ?? '';
          chain = chain.command(({ tr, dispatch }) => {
            if (dispatch) tr.insertText(text, from, to);
            return true;
          });
          if (text.length > 0) {
            chain = chain.setProvenance(from, from + text.length, {
              kind: 'COMMAND',
              actionId: null,
            });
          }
        }
        for (const { item } of [...changes, ...notes]) chain = chain.removeTrackedChange(item.id);
        chain.run();
        done = [...changes.map((c) => c.item), ...notes.map((n) => n.item)];
      } else {
        for (const item of done) editor.commands.removeTrackedChange(item.id);
      }
      const ids = new Set(done.map((i) => i.id));
      setOrder((list) => list.filter((i) => !ids.has(i.id)));
      setDecided((n) => n + done.length);
      activate(live().find((i) => !ids.has(i.id))?.id ?? null);
      setBusy(true);
      try {
        for (const item of done) await session.decide(item.id, accepted);
      } finally {
        setBusy(false);
      }
    },
    [editor, session, live, activate],
  );

  const items = session ? live() : [];
  const index = items.findIndex((i) => i.id === activeId);
  const current = index >= 0 ? items[index] : null;

  const step = useCallback(
    (by: number) => {
      if (items.length === 0) return;
      const at = index < 0 ? 0 : (index + by + items.length) % items.length;
      activate(items[at]?.id ?? null);
    },
    [items, index, activate],
  );

  // The keys, while the review is open. The chapter is read-only, so Y and N cannot type.
  useEffect(() => {
    if (!session) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      const key = e.key.toLowerCase();
      if (key === 'escape') exit();
      else if (key === 'y' && current) void decide(current.id, true);
      else if (key === 'n' && current) void decide(current.id, false);
      else if (key === 'arrowdown' || key === 'j') step(1);
      else if (key === 'arrowup' || key === 'k') step(-1);
      else return;
      // The review owns these keys while it is open. Without stopping them here, Y on a focused
      // row of the proofreading list was taken twice, once here and once by the row.
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [session, current, decide, exit, step]);

  if (!session) return null;

  const isNote = current?.replacement === null;
  const barStyle = placement
    ? { left: placement.left, width: placement.width, right: 'auto', marginInline: 0 }
    : undefined;
  const allDone = items.length === 0;

  return (
    <section
      data-testid="review-mode"
      aria-label={`Review mode: ${session.title}`}
      style={barStyle}
      className="fixed inset-x-0 bottom-16 z-40 mx-auto lg:bottom-3 w-[min(46rem,calc(100vw-2rem))] rounded-lg border border-line-strong bg-surface px-3 py-2 text-xs shadow-lg"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="font-semibold text-ink">Review · {session.title}</span>
        {allDone ? (
          <span data-testid="review-mode-done" className="text-ok">
            All suggestions resolved!
          </span>
        ) : (
          <span className="flex items-center gap-1 text-muted" data-testid="review-mode-count">
            <button
              type="button"
              aria-label="Previous (up arrow)"
              onClick={() => step(-1)}
              className="rounded px-1 hover:bg-sunk"
            >
              ↑
            </button>
            {index + 1} / {items.length}
            <button
              type="button"
              aria-label="Next (down arrow)"
              onClick={() => step(1)}
              className="rounded px-1 hover:bg-sunk"
            >
              ↓
            </button>
          </span>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {allDone ? (
            <>
              {session.rerun ? (
                <button
                  type="button"
                  data-testid="review-mode-rerun"
                  onClick={() => {
                    const run = session.rerun?.run;
                    exit();
                    callbacks.current.onShowChecks?.();
                    run?.();
                  }}
                  className="underline"
                >
                  {session.rerun.label}
                </button>
              ) : null}
              {session.next ? (
                <button
                  type="button"
                  data-testid="review-mode-next"
                  onClick={() => {
                    const open = session.next?.open;
                    exit();
                    callbacks.current.onShowChecks?.();
                    // After the tab and the drawer have drawn.
                    window.setTimeout(() => open?.(), 50);
                  }}
                  className="rounded-md border border-line-strong px-2 py-0.5 font-semibold text-ink hover:bg-sunk"
                >
                  Try next: {session.next.label}
                </button>
              ) : null}
            </>
          ) : (
            <>
              <button
                type="button"
                data-testid="review-mode-reject-all"
                disabled={busy}
                onClick={() => void decideAll(false)}
                className="text-muted underline hover:text-ink disabled:opacity-50"
              >
                {isNote ? 'Ignore all' : 'Reject all'}
              </button>
              <button
                type="button"
                data-testid="review-mode-accept-all"
                disabled={busy}
                onClick={() => void decideAll(true)}
                className="underline disabled:opacity-50"
              >
                {isNote ? 'Resolve all' : 'Accept all'} {items.length}
              </button>
              <button
                type="button"
                data-testid="review-mode-reject"
                disabled={!current || busy}
                onClick={() => current && void decide(current.id, false)}
                className="rounded-md border border-line-strong px-2 py-0.5 text-ink hover:bg-sunk disabled:opacity-50"
              >
                {isNote ? 'Ignore' : 'Reject'} (N)
              </button>
              <button
                type="button"
                data-testid="review-mode-accept"
                disabled={!current || busy}
                onClick={() => current && void decide(current.id, true)}
                className="rounded-md bg-accent px-2 py-0.5 font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-50"
              >
                {isNote ? 'Resolve' : 'Accept'} (Y)
              </button>
            </>
          )}
          <button
            type="button"
            data-testid="review-mode-exit"
            onClick={exit}
            className="text-muted underline hover:text-ink"
          >
            Resume editing (Esc)
          </button>
        </span>
      </div>
      {current ? (
        <p className="mt-1.5 text-muted" data-testid="review-mode-current">
          <span className="font-semibold text-ink">{current.label}</span>
          {current.replacement !== null ? (
            <>
              {' · '}
              <del className="text-warn">{short(current.original, 60)}</del>
              {' → '}
              <ins className="font-semibold text-ok no-underline">
                {current.replacement ? short(current.replacement, 60) : '(removed)'}
              </ins>
            </>
          ) : null}
          {current.why ? ` · ${short(current.why, 220)}` : ''}
        </p>
      ) : null}
      {decided > 0 || skipped > 0 ? (
        <p className="mt-1 text-faint">
          {decided} decided
          {skipped > 0
            ? ` · ${skipped} could not be shown because the words have changed since the check; they stay in the list`
            : ''}
        </p>
      ) : null}
    </section>
  );
}
