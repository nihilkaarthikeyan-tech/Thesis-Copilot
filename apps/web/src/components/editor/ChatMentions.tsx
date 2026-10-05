'use client';

/**
 * `@` in chat — "what does @LeCun 2015 say about depth?"
 *
 * The library scope searches every source in the library (or the chapter's pinned ones), which is
 * right for "what do my sources say about…" and wrong for "what does *this* paper say about…".
 * Naming papers with `@` answers the question from those alone. The chips are the whole of the
 * state: what is shown above the box is exactly what the answer will be drawn from.
 *
 * A source with no text yet (a reference that was never resolved, a PDF still being read) can be
 * named, and says so — the server then answers that there is nothing in it to read, rather than
 * the picker hiding it and the student wondering where their paper went.
 */

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { mentionLabel } from '@/lib/mentions';

type LibrarySource = {
  id: string;
  status: string;
  title: string | null;
  authors: unknown;
  year: number | null;
  groundingLevel: string;
  doi?: string | null;
  rawReference?: string | null;
};

export type Mention = { id: string; label: string; readable: boolean };

export function useChatMentions(documentId: string, enabled: boolean) {
  const [library, setLibrary] = useState<LibrarySource[]>([]);
  const [mentions, setMentions] = useState<Mention[]>([]);

  useEffect(() => {
    if (!enabled) return;
    api<LibrarySource[]>(`/documents/${documentId}/sources`)
      .then(setLibrary)
      .catch(() => undefined);
  }, [documentId, enabled]);

  const add = useCallback((mention: Mention) => {
    setMentions((list) => (list.some((m) => m.id === mention.id) ? list : [...list, mention]));
  }, []);
  const remove = useCallback((id: string) => {
    setMentions((list) => list.filter((m) => m.id !== id));
  }, []);
  const clear = useCallback(() => setMentions([]), []);

  const candidates = useCallback(
    (query: string): Mention[] => {
      const needle = query.toLowerCase();
      return library
        .filter((source) => !mentions.some((m) => m.id === source.id))
        .map((source) => ({
          source,
          label: mentionLabel(source),
          haystack: `${mentionLabel(source)} ${source.title ?? ''}`.toLowerCase(),
        }))
        .filter((c) => !needle || c.haystack.includes(needle))
        .slice(0, 8)
        .map((c) => ({
          id: c.source.id,
          label: c.label,
          readable: c.source.groundingLevel !== 'NONE',
        }));
    },
    [library, mentions],
  );

  return { mentions, add, remove, clear, candidates, library, hasLibrary: library.length > 0 };
}

export function MentionChips({
  mentions,
  onRemove,
}: {
  mentions: readonly Mention[];
  onRemove: (id: string) => void;
}) {
  if (mentions.length === 0) return null;
  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-1" data-testid="chat-mentions">
      <span className="text-[11px] text-muted">Answering only from</span>
      {mentions.map((mention) => (
        <span
          key={mention.id}
          data-testid="chat-mention"
          className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent-soft px-2 py-0.5 text-[11px] text-ink"
          title={mention.readable ? undefined : 'No readable text yet'}
        >
          {mention.label}
          {mention.readable ? null : <span className="text-muted">(no text)</span>}
          <button
            type="button"
            aria-label={`Stop answering from ${mention.label}`}
            className="text-muted hover:text-ink"
            onClick={() => onRemove(mention.id)}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

export function MentionPicker({
  query,
  options,
  active,
  onPick,
}: {
  query: string;
  options: readonly Mention[];
  /** The option Enter would pick, moved with the arrow keys from the box. */
  active: number;
  onPick: (mention: Mention) => void;
}) {
  return (
    <div
      data-testid="chat-mention-picker"
      className="absolute bottom-full left-0 z-20 mb-1 w-full rounded-md border border-line bg-surface p-1 shadow-lg"
    >
      {options.length === 0 ? (
        <p className="px-2 py-1.5 text-xs text-muted">
          {query ? `No paper in your library matches “${query}”.` : 'Your library is empty.'}
        </p>
      ) : (
        <ul className="grid list-none p-0">
          {options.map((option, index) => (
            <li key={option.id}>
              <button
                type="button"
                data-testid="chat-mention-option"
                aria-current={index === active ? 'true' : undefined}
                // Keeps the focus in the box, so typing carries on after a pick.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onPick(option)}
                className={`w-full rounded px-2 py-1 text-left text-[13px] hover:bg-sunk ${
                  index === active ? 'bg-sunk' : ''
                }`}
              >
                {option.label}
                {option.readable ? null : (
                  <span className="ml-1 text-[11px] text-muted">· no readable text yet</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
