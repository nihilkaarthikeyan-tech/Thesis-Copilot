'use client';

/**
 * Chat over the library — PRD FR-4.9, PHASES v2 W9.4.
 *
 * A third tab in the right panel. Answers stream over SSE and cite only the passages the server
 * sent; a citation in an answer opens the same passage popover the editor uses. The two scripted
 * replies A.4 specifies are rendered as states with an action rather than as plain text.
 */

import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '@/lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Citation = { key: string; sourceId: string; chunkId: string; label: string };

type Turn = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  citations?: Citation[];
  outcome?: string;
};

type Filters = {
  yearFrom?: number | null;
  yearTo?: number | null;
  minCitations?: number | null;
  excludePreprints?: boolean;
};

export function ChatPanel({
  documentId,
  onUsageChange,
  onOpenPassage,
}: {
  documentId: string;
  onUsageChange: () => void;
  onOpenPassage: (sourceId: string, chunkId: string) => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({});
  const [showFilters, setShowFilters] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<{ turns: Turn[] }>(`/chat/${documentId}`)
      .then((h) => setTurns(h.turns))
      .catch(() => undefined);
    api<{ chatFilters?: Filters }>('/settings')
      .then((s) => setFilters(s.chatFilters ?? {}))
      .catch(() => undefined);
  }, [documentId]);

  const shown = turns.length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the thread grows
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [shown, streaming]);

  async function ask(event: FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || busy) return;
    setBusy(true);
    setError(null);
    setDraft('');
    // The server assigns its own id when it stores the turn; this one only has to be unique
    // in this list until the thread is reloaded.
    setTurns((list) => [...list, { id: crypto.randomUUID(), role: 'user', text: message }]);
    setStreaming('');

    try {
      const response = await fetch(`${API_URL}/api/v1/chat`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({ documentId, message, filters }),
      });
      if (!response.ok || !response.body) {
        const problem = (await response.json().catch(() => null)) as {
          detail?: string;
          title?: string;
        } | null;
        throw new Error(problem?.detail ?? problem?.title ?? `HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let text = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const eventName = /^event:\s*(.*)$/m.exec(frame)?.[1]?.trim();
          const dataLine = /^data:\s*(.*)$/m.exec(frame)?.[1];
          if (!eventName || !dataLine) continue;
          const data = JSON.parse(dataLine) as Record<string, unknown>;
          if (eventName === 'token') {
            text += String(data.t ?? '');
            setStreaming(text);
          } else if (eventName === 'done') {
            setTurns((list) => [
              ...list,
              {
                id: crypto.randomUUID(),
                role: 'assistant',
                text: String(data.text ?? text),
                citations: (data.citations as Citation[]) ?? [],
                outcome: String(data.outcome ?? 'answered'),
              },
            ]);
            setStreaming('');
          } else if (eventName === 'error') {
            throw new Error(String(data.message ?? 'The answer did not finish.'));
          }
        }
      }
      onUsageChange();
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : (e as Error).message,
      );
      setStreaming('');
    } finally {
      setBusy(false);
    }
  }

  async function saveFilters(next: Filters) {
    setFilters(next);
    await api('/settings', { method: 'PUT', body: JSON.stringify({ chatFilters: next }) }).catch(
      () => undefined,
    );
  }

  return (
    <div data-testid="chat-panel" className="flex h-full flex-col">
      <div className="flex items-baseline justify-between px-1 pb-2 text-xs text-muted">
        <span>Answers come only from your library.</span>
        <button type="button" className="underline" onClick={() => setShowFilters((v) => !v)}>
          Filters
        </button>
      </div>

      {showFilters ? (
        <div className="mb-2 space-y-2 rounded-md border border-line bg-surface p-2 text-xs">
          <label className="flex items-center justify-between gap-2">
            Published from
            <input
              type="number"
              className="w-20 rounded border border-line px-1"
              value={filters.yearFrom ?? ''}
              onChange={(e) =>
                void saveFilters({
                  ...filters,
                  yearFrom: e.target.value ? Number(e.target.value) : null,
                })
              }
            />
          </label>
          <label className="flex items-center justify-between gap-2">
            Minimum citations
            <input
              type="number"
              className="w-20 rounded border border-line px-1"
              value={filters.minCitations ?? ''}
              onChange={(e) =>
                void saveFilters({
                  ...filters,
                  minCitations: e.target.value ? Number(e.target.value) : null,
                })
              }
            />
          </label>
          <label className="flex items-center justify-between gap-2">
            Exclude preprints
            <input
              type="checkbox"
              checked={filters.excludePreprints ?? false}
              onChange={(e) => void saveFilters({ ...filters, excludePreprints: e.target.checked })}
            />
          </label>
        </div>
      ) : null}

      <div className="flex-1 space-y-3 overflow-y-auto px-1" aria-live="polite">
        {turns.length === 0 && !streaming ? (
          <p className="text-sm text-muted">
            Ask about the papers you have pinned or added — what they found, where they disagree,
            what is missing. For writing, use Assist or Draft in the editor.
          </p>
        ) : null}
        {turns.map((turn) => (
          <div
            key={turn.id}
            data-role={turn.role}
            className={`rounded-lg px-3 py-2 text-sm ${
              turn.role === 'user' ? 'ml-auto max-w-[90%] bg-ink text-paper' : 'bg-surface'
            }`}
          >
            {turn.role === 'assistant' ? (
              <AnswerText
                text={turn.text}
                citations={turn.citations ?? []}
                onOpen={onOpenPassage}
              />
            ) : (
              turn.text
            )}
            {turn.outcome === 'not-enough' ? (
              <p className="mt-2 text-xs text-muted">
                Add sources from the Discover tab, then ask again.
              </p>
            ) : null}
          </div>
        ))}
        {streaming ? (
          <div className="rounded-lg bg-surface px-3 py-2 text-sm text-muted">{streaming}</div>
        ) : null}
        <div ref={endRef} />
      </div>

      {error ? (
        <p role="alert" className="px-1 py-2 text-xs text-warn">
          {error}
        </p>
      ) : null}

      <form onSubmit={ask} className="mt-2 flex gap-2 border-t border-line pt-2">
        <label className="sr-only" htmlFor="chat-message">
          Ask about your library
        </label>
        <input
          id="chat-message"
          value={draft}
          disabled={busy}
          maxLength={2000}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="What do my sources say about…"
          className="h-9 flex-1 rounded-md border border-line px-2 text-sm"
        />
        <button
          type="submit"
          disabled={busy || draft.trim().length === 0}
          className="rounded-md bg-ink px-3 text-sm text-paper disabled:opacity-50"
        >
          {busy ? '…' : 'Ask'}
        </button>
      </form>
    </div>
  );
}

/** Renders `{{cite:ID}}` as a button that opens the passage it stands on. */
function AnswerText({
  text,
  citations,
  onOpen,
}: {
  text: string;
  citations: Citation[];
  onOpen: (sourceId: string, chunkId: string) => void;
}) {
  // Keyed by where the part starts in the answer: unique, and stable while the text is.
  let offset = 0;
  const parts = text.split(/(\{\{cite:[^}]+\}\})/g).map((part) => {
    const at = offset;
    offset += part.length;
    return { part, at };
  });
  return (
    <p className="whitespace-pre-wrap">
      {parts.map(({ part, at }) => {
        const key = /^\{\{cite:([^}]+)\}\}$/.exec(part)?.[1];
        if (!key) return <span key={`t-${at}`}>{part}</span>;
        const citation = citations.find((c) => c.key === key);
        if (!citation) return null;
        return (
          <button
            key={`c-${at}`}
            type="button"
            onClick={() => onOpen(citation.sourceId, citation.chunkId)}
            className="mx-0.5 rounded bg-accent/10 px-1 text-accent underline"
          >
            {citation.label}
          </button>
        );
      })}
    </p>
  );
}
