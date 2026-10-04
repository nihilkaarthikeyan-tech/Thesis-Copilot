'use client';

/**
 * Find papers beside the text (2026-10-04, from the Jenni study).
 *
 * Searching for papers lived on a separate page (Discover, about 80 s) or hid behind chat's "Find
 * papers" scope. Jenni keeps it in a panel next to the document with a suggested query, sorting and
 * a Cite button on each result. This panel does the same on the search chat's web scope already
 * uses (`POST /chat/web`: OpenAlex, Semantic Scholar, PubMed, arXiv — no model call, no allowance).
 *
 * Under each result, the sentence or two of its abstract that match the search, labelled "From
 * the abstract", with the searched words in bold (coverage-map row 23). The API picks them,
 * verbatim, from the abstract the index returned; with no match the abstract's opening shows as
 * before, unlabelled.
 *
 * Citing stays honest: a paper can be cited only once it is in the library and resolved, because a
 * citation here must point at a record the student has (§10.6). "Add" fetches it; "Cite here"
 * appears when it is ready.
 */

import { newCitationKey } from '@tc/ui';
import type { Editor } from '@tiptap/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { type MatchedPassage, passageRuns } from '@/lib/passage';

type Result = {
  title: string;
  abstract: string | null;
  /** The abstract's sentences that match the query, verbatim; null when none do. */
  matchedPassage?: MatchedPassage | null;
  year: number | null;
  venue: string | null;
  doi: string | null;
  citationCount: number | null;
  isPreprint: boolean;
  openAccess: boolean;
  inLibrary: boolean;
  via?: string;
  reference: { raw: string; doi?: string };
};

type LibrarySource = {
  id: string;
  doi: string | null;
  title: string | null;
  rawReference: string | null;
  status: string;
};

type Sort = 'relevance' | 'newest' | 'cited';

const RECENT_KEY = 'tc:recent-paper-searches';

function readRecent(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((v) => typeof v === 'string').slice(0, 5) : [];
  } catch {
    return [];
  }
}

function rememberRecent(query: string): string[] {
  const next = [query, ...readRecent().filter((q) => q !== query)].slice(0, 5);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Blocked storage: the panel simply does not remember.
  }
  return next;
}

const normDoi = (doi: string | null | undefined) => (doi ?? '').trim().toLowerCase();

/** Sorts a copy; "relevance" keeps the order the search returned. */
export function sortResults<T extends { year: number | null; citationCount: number | null }>(
  results: readonly T[],
  sort: Sort,
): T[] {
  const copy = [...results];
  if (sort === 'newest') copy.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  if (sort === 'cited') copy.sort((a, b) => (b.citationCount ?? -1) - (a.citationCount ?? -1));
  return copy;
}

export function FindPapersPanel({
  documentId,
  documentTitle,
  editor,
  initialQuery,
}: {
  documentId: string;
  documentTitle: string;
  editor: Editor | null;
  /**
   * A sentence the student selected and asked papers for (2026-10-04, from the Jenni study:
   * "Find citations" on a selection). Searched at once; a new nonce searches again.
   */
  initialQuery?: { text: string; nonce: number } | null;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>('relevance');
  const [openOnly, setOpenOnly] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [library, setLibrary] = useState<LibrarySource[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => setRecent(readRecent()), []);

  const loadLibrary = useCallback(async () => {
    try {
      setLibrary(await api<LibrarySource[]>(`/documents/${documentId}/sources`));
    } catch {
      // The panel still searches; it just cannot say what is already in.
    }
  }, [documentId]);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  // A paper being added is resolved in the background; look again until it is ready to cite.
  const waiting = library.some((s) => s.status === 'PENDING');
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void loadLibrary(), 3_000);
    return () => clearInterval(timer);
  }, [waiting, loadLibrary]);

  const run = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q) return;
      setQuery(q);
      setBusy(true);
      setError(null);
      setRecent(rememberRecent(q));
      try {
        const found = await api<{ results: Result[] }>('/chat/web', {
          method: 'POST',
          body: JSON.stringify({ documentId, message: q }),
        });
        setResults(found.results);
      } catch (e) {
        setError(
          e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : (e as Error).message,
        );
      } finally {
        setBusy(false);
      }
    },
    [documentId],
  );

  useEffect(() => {
    if (initialQuery?.text) void run(initialQuery.text.slice(0, 300));
  }, [initialQuery, run]);

  const inLibrary = useCallback(
    (result: Result): LibrarySource | undefined =>
      library.find(
        (s) =>
          (result.doi && normDoi(s.doi) === normDoi(result.doi)) ||
          (s.rawReference && s.rawReference === result.reference.raw),
      ),
    [library],
  );

  async function add(result: Result) {
    setAdding(result.title);
    setError(null);
    try {
      await api(`/documents/${documentId}/sources/resolve`, {
        method: 'POST',
        body: JSON.stringify({ references: [result.reference] }),
      });
      await loadLibrary();
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not add that paper.',
      );
    } finally {
      setAdding(null);
    }
  }

  async function cite(source: LibrarySource, result: Result) {
    if (!editor) return;
    if (!editor.state.selection.empty) {
      setNotice('Click where the citation should go, with no text selected, then press Cite here.');
      return;
    }
    // The label the picker would show, so the citation reads right at once.
    let label = '';
    let numeric = false;
    try {
      const words = (source.title ?? result.title).split(/\s+/).slice(0, 4).join(' ');
      const pick = await api<{
        sources: Array<{ sourceId: string; label: string }>;
        numeric?: boolean;
      }>(`/documents/${documentId}/citations/pick?q=${encodeURIComponent(words)}`);
      label = pick.sources.find((s) => s.sourceId === source.id)?.label ?? '';
      numeric = pick.numeric === true;
    } catch {
      // The placeholder shows until the next render brings the label.
    }
    const key = newCitationKey();
    const store = (editor.storage as { citation?: { renderedMap?: Record<string, string> } })
      .citation;
    if (store?.renderedMap && label && !numeric) store.renderedMap[key] = label;
    editor.chain().focus().insertCitation({ key, sourceId: source.id, chunkId: null }).run();
    setNotice(`Cited ${label || 'the paper'} at the cursor.`);
  }

  const shown = useMemo(() => {
    const list = results ?? [];
    return sortResults(openOnly ? list.filter((r) => r.openAccess) : list, sort);
  }, [results, sort, openOnly]);

  const button =
    'rounded-md border border-line-strong bg-surface px-2.5 py-1 text-xs font-semibold text-accent transition-colors hover:bg-sunk disabled:opacity-50';

  return (
    <div data-testid="find-papers" className="grid gap-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(query);
        }}
        className="flex gap-2"
      >
        <input
          aria-label="Search papers"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search OpenAlex, Semantic Scholar, PubMed, arXiv…"
          className="min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm"
        />
        <button type="submit" disabled={busy || !query.trim()} className={button}>
          {busy ? 'Searching…' : 'Search'}
        </button>
      </form>

      {results === null && !busy ? (
        <div className="grid gap-1 text-xs">
          <p className="text-muted">Suggested from your thesis</p>
          <button
            type="button"
            onClick={() => void run(documentTitle)}
            className="rounded-md border border-line px-2 py-1.5 text-left hover:bg-sunk"
          >
            {documentTitle}
          </button>
          <button
            type="button"
            onClick={() => {
              const text = editor?.state.selection.$from.parent.textContent ?? '';
              void run(text.slice(0, 200));
            }}
            className="rounded-md border border-line px-2 py-1.5 text-left hover:bg-sunk"
          >
            Papers for the paragraph you are writing
          </button>
          {recent.length > 0 ? <p className="mt-2 text-muted">Recent searches</p> : null}
          {recent.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => void run(q)}
              className="truncate rounded px-2 py-1 text-left text-muted hover:bg-sunk hover:text-ink"
            >
              {q}
            </button>
          ))}
        </div>
      ) : null}

      {results !== null ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1">
            Sort
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              className="rounded border border-line bg-surface px-1 py-0.5"
            >
              <option value="relevance">Relevance</option>
              <option value="newest">Newest</option>
              <option value="cited">Most cited</option>
            </select>
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={openOnly}
              onChange={(e) => setOpenOnly(e.target.checked)}
            />
            Open access only
          </label>
          <span className="text-muted">{shown.length} papers</span>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-xs text-warn">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-xs text-muted">
          {notice}
        </p>
      ) : null}

      {results !== null && shown.length === 0 && !busy ? (
        <p className="text-sm text-muted">
          Nothing came back for that. Try the key terms of the topic rather than a question.
        </p>
      ) : null}

      {shown.map((result) => {
        const source = inLibrary(result);
        const ready = source?.status === 'RESOLVED';
        return (
          <article
            key={result.doi ?? result.title}
            data-testid="paper-result"
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
            {result.matchedPassage ? (
              <div data-testid="paper-passage" className="mt-1 border-l-2 border-line pl-2">
                <p className="text-[10.5px] uppercase tracking-wide text-faint">
                  From the abstract
                </p>
                <p className="text-xs text-ink">
                  {result.matchedPassage.clippedStart ? '… ' : ''}
                  {passageRuns(result.matchedPassage).map((run, i) =>
                    run.match ? (
                      // biome-ignore lint/suspicious/noArrayIndexKey: runs are fixed for a result
                      <strong key={i} className="font-semibold">
                        {run.text}
                      </strong>
                    ) : (
                      // biome-ignore lint/suspicious/noArrayIndexKey: runs are fixed for a result
                      <span key={i}>{run.text}</span>
                    ),
                  )}
                  {result.matchedPassage.clippedEnd ? ' …' : ''}
                </p>
              </div>
            ) : result.abstract ? (
              <p className="mt-1 line-clamp-3 text-xs text-muted">{result.abstract}</p>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {ready && source ? (
                <button
                  type="button"
                  data-testid="paper-cite"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void cite(source, result)}
                  className={button}
                >
                  Cite here
                </button>
              ) : source ? (
                <span className="text-xs text-muted">Adding to your library…</span>
              ) : (
                <button
                  type="button"
                  data-testid="paper-add"
                  disabled={adding === result.title}
                  onClick={() => void add(result)}
                  className={button}
                >
                  {adding === result.title ? 'Adding…' : 'Add to library'}
                </button>
              )}
              {result.doi ? (
                <a
                  href={`https://doi.org/${result.doi}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-muted underline hover:text-ink"
                >
                  {result.doi.startsWith('10.48550/arxiv.') ? 'arXiv page' : 'View paper'}
                </a>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}
