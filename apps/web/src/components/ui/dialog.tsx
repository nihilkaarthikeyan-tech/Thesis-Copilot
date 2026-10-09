'use client';

import { type ReactNode, useEffect, useRef } from 'react';
import { isOnBackdrop } from '@/lib/dialog-backdrop';

/**
 * A modal dialog on the native `<dialog>`: focus is trapped and Escape closes it without any
 * library, and the page behind is inert while it is open.
 */
export function Dialog({
  open,
  title,
  onClose,
  children,
  testId,
  size = 'md',
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
  /** `wide` for a dialog with two columns (the export dialog, R27); never wider than the screen. */
  size?: 'md' | 'wide';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  // A click on the dim backdrop closes the dialog, but only when the press also began there: a
  // selection dragged from inside the dialog and released over the backdrop must not.
  const pressedBackdrop = useRef(false);
  const onBackdrop = (e: { target: EventTarget; clientX: number; clientY: number }) => {
    const dialog = ref.current;
    if (!dialog) return false;
    return isOnBackdrop(e.target === dialog, dialog.getBoundingClientRect(), {
      x: e.clientX,
      y: e.clientY,
    });
  };
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the backdrop click is a mouse shortcut; Escape and the × already close it from the keyboard.
    <dialog
      ref={ref}
      onPointerDown={(e) => {
        pressedBackdrop.current = onBackdrop(e);
      }}
      onClick={(e) => {
        const close = pressedBackdrop.current && onBackdrop(e);
        pressedBackdrop.current = false;
        if (close) onClose();
      }}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      data-testid={testId}
      aria-labelledby={testId ? `${testId}-title` : undefined}
      className={`m-auto max-h-[calc(100dvh-2rem)] ${size === 'wide' ? 'w-[min(60rem,calc(100vw-2rem))]' : 'w-[min(32rem,calc(100vw-2rem))]'} overflow-y-auto rounded-lg border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-ink/40`}
    >
      {open ? (
        <div className="p-4 sm:p-5">
          {/* QA 2026-10-09: on a phone a long dialog's only way out was a button at the bottom of
              the scroll. The × stays in reach at the top as the dialog scrolls. */}
          <div className="sticky -top-4 z-10 -mx-4 -mt-4 flex items-start gap-2 bg-surface px-4 pb-1 pt-4 sm:-top-5 sm:-mx-5 sm:-mt-5 sm:px-5 sm:pt-5">
            <h2
              id={testId ? `${testId}-title` : undefined}
              className="min-w-0 flex-1 text-[17px] font-bold"
            >
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Leave this dialog"
              data-testid={testId ? `${testId}-x` : undefined}
              className="-mr-1 grid h-8 w-8 shrink-0 place-items-center rounded-md text-[20px] leading-none text-muted hover:bg-sunk hover:text-ink"
            >
              ×
            </button>
          </div>
          <div className="mt-2 text-sm">{children}</div>
        </div>
      ) : null}
    </dialog>
  );
}
