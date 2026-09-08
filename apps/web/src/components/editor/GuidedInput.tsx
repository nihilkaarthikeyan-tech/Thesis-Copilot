'use client';

/**
 * The guided-suggestion input — PRD §2.2 shortcuts, FR-4.3, PHASES 3.7.
 *
 *   "Small inline input; instruction passed as `<instruction>`; `guided: true` on the event."
 *
 * `Shift+→` asks the plugin for an instruction, which is a promise. This renders the input that
 * resolves it. `window.prompt` did the job but steals focus from the document, blocks the whole
 * page, and cannot be styled or dismissed with Escape the way the rest of the editor is.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

type Pending = { resolve: (value: string | null) => void };

export type GuidedController = {
  /** Handed to the ghost-text plugin as `promptForInstruction`. */
  ask: () => Promise<string | null>;
};

export function useGuidedInput(): { controller: GuidedController; element: React.ReactNode } {
  const [pending, setPending] = useState<Pending | null>(null);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  // The plugin captures `promptForInstruction` once when the extensions are built, so the
  // controller identity has to be stable across renders.
  const pendingRef = useRef<Pending | null>(null);
  const controllerRef = useRef<GuidedController>({
    ask: () =>
      new Promise<string | null>((resolve) => {
        const entry = { resolve };
        pendingRef.current = entry;
        setPending(entry);
      }),
  });

  const finish = useCallback((result: string | null) => {
    pendingRef.current?.resolve(result);
    pendingRef.current = null;
    setPending(null);
    setValue('');
  }, []);

  useEffect(() => {
    if (pending) inputRef.current?.focus();
  }, [pending]);

  // A pending promise must always settle, even if the component unmounts mid-ask, or the plugin
  // would wait for ever and the student's next Shift+→ would be ignored.
  useEffect(
    () => () => {
      pendingRef.current?.resolve(null);
      pendingRef.current = null;
    },
    [],
  );

  const element = pending ? (
    <form
      data-testid="guided-input"
      className="fixed bottom-20 left-1/2 z-30 w-[28rem] -translate-x-1/2 rounded-md border border-line bg-surface p-3 shadow-lg"
      onSubmit={(event) => {
        event.preventDefault();
        finish(value.trim() || null);
      }}
    >
      <label className="text-xs text-muted" htmlFor="guided-instruction">
        Guide this suggestion
      </label>
      <input
        id="guided-instruction"
        ref={inputRef}
        className="mt-1 w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-sunk"
        placeholder="e.g. mention cost barriers"
        maxLength={500}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            finish(null);
          }
        }}
      />
      <p className="mt-1 text-xs text-muted">Enter to ask · Esc to cancel</p>
    </form>
  ) : null;

  return { controller: controllerRef.current, element };
}
