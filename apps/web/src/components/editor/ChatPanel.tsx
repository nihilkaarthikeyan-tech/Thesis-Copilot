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
import { cn } from '@/lib/utils';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Citation = { key: string; sourceId: string; chunkId: string; label: string };

type Turn = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  citations?: Citation[];
  outcome?: string;
  /** The scope the question was asked in, which the advice under a refusal depends on. */
  scope?: Scope;
};

type Filters = {
  yearFrom?: number | null;
  yearTo?: number | null;
  minCitations?: number | null;
  excludePreprints?: boolean;
};

/**
 * ADR-0016. Three places an answer can come from, and they are not equivalent:
 *
 * - `library` — the uploaded sources. Grounded, cited, and the default.
 * - `document` — the student's own chapters. Answered from, never citable.
 * - `web` — the scholarly indexes. **Returns candidate sources, not an answer.**
 */
type Scope = 'library' | 'document' | 'web';
const SCOPES: readonly Scope[] = ['library', 'document', 'web'];
const SCOPE_LABEL: Record<Scope, string> = {
  library: 'Library',
  document: 'This thesis',
  web: 'Find papers',
};
const SCOPE_BLURB: Record<Scope, string> = {
  library: 'Answers come only from your library, and cite the passage they came from.',
  document:
    'Answers come only from what you have written. Nothing here is citable — your own draft is not a source.',
  web: 'Searches the literature and shows real papers. It does not answer the question: add a paper to your library and ask again to get a grounded answer.',
};

// The prompt has to change with the scope. "What do my sources say about…" in Find-papers mode
// invites the question this scope deliberately does not answer.
const SCOPE_PLACEHOLDER: Record<Scope, string> = {
  library: 'What do my sources say about…',
  document: 'What have I already written about…',
  web: 'A topic, method or population to search for…',
};
const SCOPE_ASK_LABEL: Record<Scope, string> = {
  library: 'Ask about your library',
  document: 'Ask about what you have written',
  web: 'Search the literature',
};

type WebResult = {
  title: string;
  abstract: string | null;
  year: number | null;
  venue: string | null;
  doi: string | null;
  citationCount: number | null;
  isPreprint: boolean;
  openAccess: boolean;
  inLibrary: boolean;
  reference: { raw: string; doi?: string };
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

  // ADR-0016. 'library' is the grounded default and what this panel has always done; 'document'
  // answers from the student's own chapters, which are not citable and never enter a bibliography.
  const [scope, setScope] = useState<Scope>('library');
  const [webResults, setWebResults] = useState<WebResult[] | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

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

    // The web scope is not a conversation. It returns papers, so it does not join the thread,
    // does not stream, and costs no cap unit — there is no model call behind it.
    if (scope === 'web') {
      try {
        const found = await api<{ results: WebResult[] }>('/chat/web', {
          method: 'POST',
          body: JSON.stringify({ documentId, message }),
        });
        setWebResults(found.results);
      } catch (e) {
        setError(
          e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : (e as Error).message,
        );
      } finally {
        setBusy(false);
      }
      return;
    }

    // The server assigns its own id when it stores the turn; this one only has to be unique
    // in this list until the thread is reloaded.
    setTurns((list) => [...list, { id: crypto.randomUUID(), role: 'user', text: message }]);
    setStreaming('');

    try {
      const response = await fetch(`${API_URL}/api/v1/chat`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({ documentId, message, filters, scope }),
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
                scope,
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

  /**
   * Promotes a search result into a real source — ADR-0016's whole point.
   *
   * The same `/sources/resolve` a pasted bibliography uses, so a paper found this way is
   * indistinguishable afterwards from one the student added by hand: fetched, chunked, embedded,
   * and citable through the grounded pipeline.
   */
  async function addToLibrary(result: WebResult) {
    setAdding(result.title);
    setError(null);
    try {
      await api(`/documents/${documentId}/sources/resolve`, {
        method: 'POST',
        body: JSON.stringify({ references: [result.reference] }),
      });
      setWebResults(
        (list) =>
          list?.map((r) => (r.title === result.title ? { ...r, inLibrary: true } : r)) ?? null,
      );
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not add that paper.',
      );
    } finally {
      setAdding(null);
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
      <div className="px-1 pb-2">
        <div className="flex items-center justify-between gap-2">
          {/* A real fieldset rather than role="group": the native element already carries the
              grouping semantics, and the legend names it without a duplicate aria-label. */}
          <fieldset className="inline-flex rounded-md border border-line bg-surface p-0.5">
            <legend className="sr-only">What to answer from</legend>
            {SCOPES.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={scope === option}
                data-testid={`chat-scope-${option}`}
                onClick={() => setScope(option)}
                className={cn(
                  'rounded-sm px-2 py-0.5 text-[11px] font-semibold transition-colors',
                  scope === option ? 'bg-accent text-accent-ink' : 'text-muted hover:text-ink',
                )}
              >
                {SCOPE_LABEL[option]}
              </button>
            ))}
          </fieldset>
          <button
            type="button"
            className="text-xs text-muted underline"
            onClick={() => setShowFilters((v) => !v)}
          >
            Filters
          </button>
        </div>
        <p className="mt-1.5 text-xs text-muted">{SCOPE_BLURB[scope]}</p>
      </div>

      {scope === 'web' && webResults ? (
        <div data-testid="web-results" className="mb-2 grid gap-2">
          {webResults.length === 0 ? (
            <p className="px-1 text-sm text-muted">
              Nothing came back for that. Try naming the method or the population rather than asking
              a question.
            </p>
          ) : null}
          {webResults.map((result) => (
            <article
              key={result.doi ?? result.title}
              className="rounded-md border border-line bg-surface p-2"
            >
              <p className="text-sm font-medium text-ink">{result.title}</p>
              <p className="mt-0.5 text-xs text-muted">
                {[result.venue, result.year, result.isPreprint ? 'preprint' : null]
                  .filter(Boolean)
                  .join(' · ')}
                {result.citationCount !== null ? ` · ${result.citationCount} citations` : ''}
                {result.openAccess ? ' · open access' : ''}
              </p>
              {result.abstract ? (
                <p className="mt-1 line-clamp-3 text-xs text-muted">{result.abstract}</p>
              ) : null}
              {result.inLibrary ? (
                <p className="mt-2 text-xs text-ok">Already in your library</p>
              ) : (
                <button
                  type="button"
                  data-testid="web-add"
                  disabled={adding === result.title}
                  onClick={() => void addToLibrary(result)}
                  className="mt-2 rounded-md border border-line-strong bg-surface px-2.5 py-1 text-xs font-semibold text-accent transition-colors hover:bg-sunk disabled:opacity-50"
                >
                  {adding === result.title ? 'Adding…' : 'Add to library'}
                </button>
              )}
            </article>
          ))}
          <p className="px-1 text-xs text-faint">
            Adding fetches the paper and indexes it. Once it is in, ask the same question on Library
            and the answer will cite it.
          </p>
        </div>
      ) : null}

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
        {turns.length === 0 && !streaming && scope !== 'web' ? (
          <p className="text-sm text-muted">
            {scope === 'library'
              ? 'Ask about the papers you have pinned or added — what they found, where they disagree, what is missing. For writing, use Assist or Draft in the editor.'
              : 'Ask about what you have already written — what a chapter argues, where you covered something, whether you have said it twice.'}
          </p>
        ) : null}
        {turns.map((turn) => (
          <div
            key={turn.id}
            data-role={turn.role}
            className={`rounded-lg px-3 py-2 text-sm ${
              turn.role === 'user' ? 'ml-auto max-w-[90%] bg-accent text-accent-ink' : 'bg-surface'
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
            {/* Only in the library scope. Telling a student to add sources is the fix when the
                question was about their library, and no help at all when it was about their own
                draft — see `docs/PENDING.md`, "A.4 refuses in the wrong words". */}
            {turn.outcome === 'not-enough' && turn.scope !== 'document' ? (
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
          {SCOPE_ASK_LABEL[scope]}
        </label>
        <input
          id="chat-message"
          value={draft}
          disabled={busy}
          maxLength={2000}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={SCOPE_PLACEHOLDER[scope]}
          className="h-9 flex-1 rounded-md border border-line px-2 text-sm"
        />
        <button
          type="submit"
          disabled={busy || draft.trim().length === 0}
          className="rounded-md px-3 text-sm disabled:opacity-50 bg-accent text-accent-ink hover:bg-accent-hover font-semibold transition-colors"
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
