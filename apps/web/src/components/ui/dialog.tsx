'use client';

import { type ReactNode, useEffect, useRef } from 'react';

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
  return (
    <dialog
      ref={ref}
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
          <h2 id={testId ? `${testId}-title` : undefined} className="text-[17px] font-bold">
            {title}
          </h2>
          <div className="mt-2 text-sm">{children}</div>
        </div>
      ) : null}
    </dialog>
  );
}
