'use client';

/**
 * Feature hints on the screen (Jenni build plan R11, ADR-0098): a small dot on a feature the
 * student has not used yet. Pressing it shows one line and **Try now** / **Dismiss**. Using the
 * feature — opening it any way at all — or dismissing it puts the dot away for good, in this
 * browser (`FirstRunHint`'s store: a sentence of guidance needs no server).
 *
 * Before this the hints were blocks above the page (the checklist, the first-session guide);
 * Jenni puts them on the feature itself, where the student is already looking.
 */

import { useEffect, useRef, useState } from 'react';
import { dismissHint, isHintDismissed } from './FirstRunHint';

const key = (id: string) => `feature-${id}`;

/** Dispatched on `window` when a feature is used, so every dot for it goes at once. */
export const FEATURE_USED = 'tc:feature-used';

/** Marks a feature used and tells the dots. */
export function noteFeatureUsed(id: string): void {
  markFeatureUsed(id);
  window.dispatchEvent(new Event(FEATURE_USED));
}

/** Marks a feature used: its dot will not show again. */
export function markFeatureUsed(id: string): void {
  dismissHint(key(id));
}

export function FeatureDot(props: {
  id: string;
  /** One line: what it is and why it helps. */
  line: string;
  onTry: () => void;
  /** Hidden while something else is teaching (the first-session guide). */
  hidden?: boolean;
}) {
  const [show, setShow] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  // After mount, so the server's render and the first client render agree.
  useEffect(() => {
    setShow(!isHintDismissed(key(props.id)));
  }, [props.id]);

  // Used elsewhere in this session (another tab, the same feature from a menu): put it away.
  useEffect(() => {
    const onStorage = () => setShow(!isHintDismissed(key(props.id)));
    window.addEventListener(FEATURE_USED, onStorage);
    return () => window.removeEventListener(FEATURE_USED, onStorage);
  }, [props.id]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!show || props.hidden) return null;

  const finish = () => {
    dismissHint(key(props.id));
    setShow(false);
    setOpen(false);
  };

  return (
    <span ref={ref} className="absolute top-1 right-1 z-20" data-testid={`feature-dot-${props.id}`}>
      <button
        type="button"
        aria-label={`What is this? ${props.line}`}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="relative flex h-2.5 w-2.5 items-center justify-center"
      >
        <span className="absolute h-2.5 w-2.5 animate-ping rounded-full bg-accent opacity-40" />
        <span className="relative h-2 w-2 rounded-full bg-accent" />
      </button>
      {open ? (
        <span
          role="dialog"
          className="absolute top-4 right-0 z-30 block w-60 rounded-md border border-line bg-surface p-3 text-left text-[12.5px] font-normal normal-case text-ink shadow-lg"
          data-testid={`feature-hint-${props.id}`}
        >
          <span className="block">{props.line}</span>
          <span className="mt-2 flex justify-end gap-3">
            <button type="button" className="text-muted underline" onClick={finish}>
              Dismiss
            </button>
            <button
              type="button"
              className="rounded-md bg-accent px-2 py-0.5 font-semibold text-accent-ink"
              onClick={() => {
                finish();
                props.onTry();
              }}
              data-testid={`feature-try-${props.id}`}
            >
              Try now
            </button>
          </span>
        </span>
      ) : null}
    </span>
  );
}
