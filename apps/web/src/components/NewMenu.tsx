'use client';

/**
 * "New ▾" (R32, ADR-0127): one menu, on the thesis list and in the editor's rail, for every way a
 * thesis begins — Jenni's New menu, with our three starts:
 *
 * - **New thesis** — ADR-0145: made at once and opened in the editor, where the "Set up this
 *   thesis" card asks for its title and the rest (`/app/new?start=topic` still works);
 * - **Upload a paper** — the same chooser on "a paper I have written", the B_PAPER path, whose
 *   proposal screen takes the upload;
 * - **Import from Word** — the same chooser with "Create and import from Word" first; the thesis
 *   opens with the existing Word import dialog up.
 *
 * New thesis makes the thesis when pressed (an untouched one leaves the list after a day); the
 * other two are links, and nothing is created until the student presses a button on `/app/new`.
 * The last item, "Ask a research question" (ADR-0132), opens a chat with no thesis at `/app/ask`.
 *
 * The menu is measured when it opens and nudged back inside the window, so it never runs off a
 * phone's edge whichever side of the screen its button ends up on after wrapping.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useT } from '@/i18n/react';
import { ApiError } from '@/lib/api';
import { createThesisForSetup, setupHref } from '@/lib/setup-card';
import { type NewStart, newThesisHref } from '@/lib/thesis-href';

const ITEMS: Array<{
  start: NewStart;
  label: 'newMenu.thesis' | 'newMenu.paper' | 'newMenu.word';
  hint: 'newMenu.thesisHint' | 'newMenu.paperHint' | 'newMenu.wordHint';
}> = [
  { start: 'topic', label: 'newMenu.thesis', hint: 'newMenu.thesisHint' },
  { start: 'paper', label: 'newMenu.paper', hint: 'newMenu.paperHint' },
  { start: 'word', label: 'newMenu.word', hint: 'newMenu.wordHint' },
];

/** The gap kept between the menu and the window's edge. */
const EDGE = 8;

export function NewMenu({
  align = 'end',
  compact = false,
  className = '',
  testId = 'new-menu',
}: {
  /** Which edge of the button the menu lines up with before it is measured. */
  align?: 'start' | 'end';
  /** The rail's small text button rather than the list's secondary button. */
  compact?: boolean;
  className?: string;
  testId?: string;
}) {
  const { t } = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function newThesis() {
    setCreating(true);
    setError(null);
    try {
      const created = await createThesisForSetup();
      setOpen(false);
      router.push(setupHref(created));
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : t('list.createError'),
      );
      setCreating(false);
    }
  }
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  // Close on a click elsewhere or Escape (focus back on the button, as a menu should).
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Inside the window, measured: the button's place depends on how its row wrapped.
  useLayoutEffect(() => {
    if (!open) {
      setShift(0);
      return;
    }
    const box = menu.current?.getBoundingClientRect();
    if (!box) return;
    const width = document.documentElement.clientWidth;
    if (box.left < EDGE) setShift(EDGE - box.left);
    else if (box.right > width - EDGE) setShift(width - EDGE - box.right);
  }, [open]);

  return (
    <div ref={root} className={`relative ${className}`} data-testid={testId}>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        data-testid={`${testId}-button`}
        className={
          compact
            ? 'rounded px-1 text-[11px] font-semibold text-muted hover:text-accent'
            : 'inline-flex h-8 items-center gap-1 rounded-md border border-line-strong bg-surface px-3 text-[13px] font-semibold text-ink transition-colors hover:bg-sunk'
        }
      >
        {t('newMenu.button')}
        <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div
          ref={menu}
          role="menu"
          aria-label={t('newMenu.label')}
          data-testid={`${testId}-items`}
          style={shift ? { transform: `translateX(${shift}px)` } : undefined}
          className={`absolute top-full z-30 mt-1 flex w-60 max-w-[calc(100vw-1rem)] flex-col gap-0.5 rounded-md border border-line bg-surface p-1.5 shadow-lg ${
            align === 'end' ? 'right-0' : 'left-0'
          }`}
        >
          {ITEMS.map((item) =>
            item.start === 'topic' ? (
              // ADR-0145: New thesis is made at once and opens in the editor, set up there.
              <button
                key={item.start}
                type="button"
                role="menuitem"
                disabled={creating}
                onClick={() => void newThesis()}
                data-testid="new-menu-topic"
                className="block min-w-0 rounded px-2.5 py-1.5 text-left hover:bg-sunk disabled:opacity-60"
              >
                <span className="block text-[13px] font-semibold text-ink">
                  {creating ? t('common.creating') : t(item.label)}
                </span>
                <span className="block text-[11.5px] leading-snug text-muted">{t(item.hint)}</span>
              </button>
            ) : (
              <Link
                key={item.start}
                href={newThesisHref(item.start)}
                role="menuitem"
                onClick={() => setOpen(false)}
                data-testid={`new-menu-${item.start}`}
                className="block min-w-0 rounded px-2.5 py-1.5 text-left hover:bg-sunk"
              >
                <span className="block text-[13px] font-semibold text-ink">{t(item.label)}</span>
                <span className="block text-[11.5px] leading-snug text-muted">{t(item.hint)}</span>
              </Link>
            ),
          )}
          {error ? (
            <p role="alert" className="px-2.5 py-1 text-[12px] text-warn">
              {error}
            </p>
          ) : null}
          {/* ADR-0132: a chat with no thesis, or across all of them. */}
          <Link
            href="/app/ask"
            role="menuitem"
            onClick={() => setOpen(false)}
            data-testid="new-menu-ask"
            className="mt-0.5 block min-w-0 rounded border-t border-line px-2.5 py-1.5 text-left hover:bg-sunk"
          >
            <span className="block text-[13px] font-semibold text-ink">{t('newMenu.ask')}</span>
            <span className="block text-[11.5px] leading-snug text-muted">
              {t('newMenu.askHint')}
            </span>
          </Link>
        </div>
      ) : null}
    </div>
  );
}
