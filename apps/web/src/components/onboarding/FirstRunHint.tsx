'use client';

/**
 * One-line first-run hints — PRD §6.1 (a screen tells the student what to do next), PHASES 5.3.
 *
 * A hint is shown until the student dismisses it, and the dismissal lives in this browser only
 * (`localStorage`): there is no server round-trip for a sentence of guidance, and a fresh device
 * showing the hints again is the right behaviour, not a bug. Every read and write is guarded —
 * private windows and blocked storage must not break the page.
 */

import { useEffect, useState } from 'react';

const PREFIX = 'tc.hint.';

export function isHintDismissed(id: string): boolean {
  try {
    return window.localStorage.getItem(PREFIX + id) === '1';
  } catch {
    return false;
  }
}

export function dismissHint(id: string): void {
  try {
    window.localStorage.setItem(PREFIX + id, '1');
  } catch {
    // Nothing to do: the hint will show again next time, which is harmless.
  }
}

export function FirstRunHint({
  id,
  children,
  className = '',
}: {
  /** Stable key, e.g. `list`, `proposal`, `editor`. */
  id: string;
  children: React.ReactNode;
  className?: string;
}) {
  // Rendered only after mount so the server and the first client render agree (no hydration
  // mismatch on a value that lives in the browser).
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(!isHintDismissed(id));
  }, [id]);

  if (!visible) return null;
  return (
    <div
      role="note"
      data-testid={`hint-${id}`}
      className={`flex items-start justify-between gap-4 rounded-md border border-accent/30 bg-accent/5 px-4 py-3 text-sm ${className}`}
    >
      <p>{children}</p>
      <button
        type="button"
        className="shrink-0 text-xs text-muted underline"
        onClick={() => {
          dismissHint(id);
          setVisible(false);
        }}
      >
        Got it
      </button>
    </div>
  );
}
