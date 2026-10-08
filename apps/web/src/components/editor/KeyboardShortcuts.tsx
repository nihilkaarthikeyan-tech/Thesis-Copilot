'use client';

/**
 * "Keyboard shortcuts" — R35, ADR-0118. Two tabs, as Jenni's shortcuts window has: the keys, and
 * the Markdown the editor turns into formatting as it is typed. Both lists come from `@tc/ui`
 * (`shortcuts.ts`), where a test types every Markdown entry into a real editor, so nothing here
 * can promise a rule the editor does not keep.
 */

import { KEY_SHORTCUTS, MARKDOWN_SHORTCUTS, macKeys } from '@tc/ui';
import { useEffect, useRef, useState } from 'react';
import { Kbd } from '../ui/primitives';

type Tab = 'keys' | 'markdown';

export function KeyboardShortcuts({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [tab, setTab] = useState<Tab>('keys');
  const [mac, setMac] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMac(/Mac|iPhone|iPad/.test(navigator.userAgent));
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const tabClass = (id: Tab) =>
    `rounded-md px-3 py-1 text-sm ${
      tab === id ? 'bg-surface font-semibold text-ink shadow-sm ring-1 ring-line' : 'text-muted'
    }`;

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-ink/30 p-4 pt-16 sm:p-6 sm:pt-16">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        data-testid="keyboard-shortcuts"
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-md border border-line bg-surface p-4 text-sm shadow-lg sm:p-6"
      >
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="shortcuts-title" className="text-lg font-bold">
            Keyboard shortcuts
          </h2>
          <button
            ref={closeRef}
            type="button"
            className="text-xs text-muted underline"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="mt-3 flex gap-1 rounded-md bg-sunk p-1" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'keys'}
            data-testid="shortcuts-tab-keys"
            className={tabClass('keys')}
            onClick={() => setTab('keys')}
          >
            Keys
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'markdown'}
            data-testid="shortcuts-tab-markdown"
            className={tabClass('markdown')}
            onClick={() => setTab('markdown')}
          >
            Markdown
          </button>
        </div>

        {tab === 'keys' ? (
          KEY_SHORTCUTS.map((group) => (
            <div key={group.title}>
              <h3 className="mt-4 font-medium">{group.title}</h3>
              <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1.5">
                {group.shortcuts.map((shortcut) => (
                  <div key={shortcut.keys} className="contents">
                    <dt className="whitespace-nowrap">
                      <Kbd>{mac ? macKeys(shortcut.keys) : shortcut.keys}</Kbd>
                    </dt>
                    <dd className="min-w-0 [overflow-wrap:anywhere]">{shortcut.does}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))
        ) : (
          <>
            <p className="mt-4 text-muted">
              Type these at the start of a line, or around a word, and they turn into formatting as
              you type. Undo (Ctrl+Z) turns one back into the characters you typed.
            </p>
            <dl
              className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1.5"
              data-testid="shortcuts-markdown"
            >
              {MARKDOWN_SHORTCUTS.map((shortcut) => (
                <div key={shortcut.typed} className="contents">
                  <dt className="whitespace-nowrap">
                    <Kbd>{shortcut.typed.replace(/ $/, '␣')}</Kbd>
                  </dt>
                  <dd className="min-w-0 [overflow-wrap:anywhere]">{shortcut.gives}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-muted">
              ␣ is a space. A chapter title is the chapter’s own first heading, so there is no
              shortcut for it.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
