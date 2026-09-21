'use client';

/**
 * Cite something on purpose — the `@` picker (2026-09-21).
 *
 * Until this existed, the only way a citation could enter a thesis was by accepting an automatic
 * suggestion that appeared when a sentence ended (`CiteSuggestions`). That is a good feature and
 * it is not going anywhere, but it made the model the only author of the bibliography: a student
 * who knew exactly which paper belonged mid-sentence had no way to say so, and a student who
 * wanted to cite something the suggester had not offered simply could not.
 *
 * Typing `@` opens this. It is a deliberate echo of the competitor's affordance, and it earns its
 * place independently — `@` is the one character that already means "name a thing" everywhere
 * else a person writes.
 *
 * **No model call.** This is the library, filtered by substring, with labels rendered by citeproc
 * on the server. It costs nothing, it is not metered, and it cannot hallucinate: a student can
 * only pick a source they have already added.
 */

import type { Editor } from '@tiptap/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

type Pickable = {
  sourceId: string;
  shortRef: string;
  label: string;
  title: string | null;
  year: number | null;
};

/** How far back from the caret an `@query` may run before it stops being one. */
const MAX_QUERY = 40;

/**
 * The `@…` the caret currently sits at the end of, if any.
 *
 * Requires whitespace (or the start of the block) before the `@`, so an email address in the
 * student's own prose does not open a citation picker halfway through it.
 */
export function activeMention(textBefore: string): string | null {
  const at = textBefore.lastIndexOf('@');
  if (at === -1) return null;
  const query = textBefore.slice(at + 1);
  if (query.length > MAX_QUERY || /[\n\r]/.test(query)) return null;
  const before = at === 0 ? '' : textBefore[at - 1];
  if (before !== '' && before !== undefined && !/\s|[([]/.test(before)) return null;
  return query;
}

export function CitePicker({
  editor,
  documentId,
  onInserted,
}: {
  editor: Editor | null;
  documentId: string;
  onInserted?: () => void;
}) {
  const [query, setQuery] = useState<string | null>(null);
  const [results, setResults] = useState<Pickable[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  // The list is keyboard-driven while focus stays in the document, so the highlighted row has to
  // be readable by the keydown handler without waiting for a re-render.
  const stateRef = useRef({ results, active, query });
  stateRef.current = { results, active, query };

  const close = useCallback(() => {
    setQuery(null);
    setResults([]);
    setActive(0);
  }, []);

  /** Replaces the `@query` the student typed with a citation node. */
  const insert = useCallback(
    (choice: Pickable) => {
      if (!editor) return;
      const { from } = editor.state.selection;
      const typed = stateRef.current.query ?? '';
      // +1 for the `@` itself. Deleting the trigger text is what makes this feel like a mention
      // rather than an insertion that leaves debris behind.
      const start = from - (typed.length + 1);
      if (start < 0) return;

      const key = `c_${Math.random().toString(36).slice(2, 12)}`;
      // The editor renders labels from its own storage; seeding it here means the new citation
      // reads correctly immediately, instead of as a placeholder until the next render call.
      const store = (editor.storage as { citation?: { renderedMap?: Record<string, string> } })
        .citation;
      if (store?.renderedMap) store.renderedMap[key] = choice.label;

      editor
        .chain()
        .focus()
        .deleteRange({ from: start, to: from })
        .insertCitation({ key, sourceId: choice.sourceId, chunkId: null })
        .run();
      close();
      onInserted?.();
    },
    [editor, close, onInserted],
  );

  // Watch the caret for an `@…` and fetch matches for it.
  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => {
      const { from, empty } = editor.state.selection;
      if (!empty) {
        close();
        return;
      }
      const textBefore = editor.state.doc.textBetween(
        Math.max(0, from - MAX_QUERY - 1),
        from,
        '\n',
      );
      const mention = activeMention(textBefore);
      setQuery(mention);
      if (mention === null) setResults([]);
    };
    editor.on('selectionUpdate', onUpdate);
    editor.on('transaction', onUpdate);
    return () => {
      editor.off('selectionUpdate', onUpdate);
      editor.off('transaction', onUpdate);
    };
  }, [editor, close]);

  useEffect(() => {
    if (query === null) return;
    let cancelled = false;
    setLoading(true);
    api<{ sources: Pickable[] }>(
      `/documents/${documentId}/citations/pick?q=${encodeURIComponent(query)}`,
    )
      .then((data) => {
        if (cancelled) return;
        setResults(data.sources.slice(0, 8));
        setActive(0);
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query, documentId]);

  // Arrow keys and Enter belong to the list while it is open, and to the document otherwise.
  // Captured on the editor's own DOM node so this wins over TipTap's keymap without registering
  // an extension, which would have meant rebuilding the extension array on every render.
  useEffect(() => {
    if (!editor) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const { results: list, active: index, query: current } = stateRef.current;
      if (current === null || list.length === 0) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActive((i) => (i + 1) % list.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((i) => (i - 1 + list.length) % list.length);
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        const choice = list[index];
        if (choice) {
          event.preventDefault();
          event.stopPropagation();
          insert(choice);
        }
      } else if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    const dom = editor.view.dom;
    dom.addEventListener('keydown', onKeyDown, true);
    return () => dom.removeEventListener('keydown', onKeyDown, true);
  }, [editor, insert, close]);

  if (query === null) return null;

  return (
    <aside
      data-testid="cite-picker"
      className="fixed bottom-24 left-1/2 z-40 w-[30rem] -translate-x-1/2 rounded-md border border-line bg-surface p-2 shadow-lg"
    >
      <p className="px-1 pb-1 text-xs text-muted">
        {query === '' ? 'Cite a source from your library' : `Sources matching “${query}”`}
      </p>
      {results.length === 0 ? (
        <p className="px-1 py-2 text-sm text-muted">
          {loading
            ? 'Looking…'
            : query === ''
              ? 'Your library is empty. Add sources in the Sources panel.'
              : 'Nothing in your library matches that. Press Esc to keep typing.'}
        </p>
      ) : (
        <ul className="grid list-none gap-0.5 p-0">
          {results.map((source, index) => (
            <li key={source.sourceId}>
              <button
                type="button"
                data-testid="cite-picker-option"
                aria-current={index === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insert(source)}
                className={`w-full rounded-md px-2 py-1.5 text-left transition-colors ${
                  index === active ? 'bg-accent-soft text-ink' : 'hover:bg-sunk'
                }`}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm">{source.title ?? source.shortRef}</span>
                  <span className="shrink-0 font-mono text-xs text-accent">{source.label}</span>
                </span>
                <span className="text-xs text-muted">
                  {source.shortRef}
                  {source.year ? ` · ${source.year}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="px-1 pt-1 text-xs text-faint">↑↓ choose · Enter insert · Esc cancel</p>
    </aside>
  );
}
