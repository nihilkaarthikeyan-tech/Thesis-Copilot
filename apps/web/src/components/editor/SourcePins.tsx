'use client';

/**
 * Chapter source pins — PRD §10.4 and §6.2, PHASES 3.1.
 *
 * Pins are the retrieval filter for this chapter: with none, §10.4 searches the whole library;
 * with some, it searches only those. That is the whole meaning of the control, so the panel says
 * it in those words rather than calling them "pins" and leaving the student to guess.
 *
 * §6.2's empty state asks for a "Pin all" shortcut, which is what a student wants on the first
 * chapter of a small library.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';

/** Resolution and indexing run in the background; the panel keeps looking until they settle. */
const POLL_MS = 3_000;

type PinnableSource = {
  id: string;
  title: string | null;
  rawReference: string | null;
  year: number | null;
  status: string;
  groundingLevel: 'NONE' | 'ABSTRACT' | 'FULL_TEXT' | string;
};

export function SourcePins({ documentId, chapterId }: { documentId: string; chapterId: string }) {
  const [sources, setSources] = useState<PinnableSource[] | null>(null);
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [library, pins] = await Promise.all([
        api<PinnableSource[]>(`/documents/${documentId}/sources`),
        api<{ sourceIds: string[] }>(`/chapters/${chapterId}/pins`),
      ]);
      setSources(library);
      setPinned(new Set(pins.sourceIds));
    } catch (e) {
      setError(
        e instanceof ApiError
          ? (e.problem.detail ?? e.problem.title)
          : 'Could not load the library.',
      );
    }
  }, [documentId, chapterId]);

  useEffect(() => {
    void load();
  }, [load]);

  // A source's grounding level is decided by two background jobs, so a panel opened seconds after
  // an upload sees every source as "nothing to quote" and stays wrong until the student reloads.
  const settling = sources?.some((s) => s.status === 'PENDING');
  useEffect(() => {
    if (!settling) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [settling, load]);

  const save = useCallback(
    async (next: Set<string>) => {
      const previous = pinned;
      setPinned(next); // Optimistic: a checkbox that lags feels broken.
      setSaving(true);
      setError(null);
      try {
        await api(`/chapters/${chapterId}/pins`, {
          method: 'PUT',
          body: JSON.stringify({ sourceIds: [...next] }),
        });
      } catch (e) {
        setPinned(previous);
        setError(
          e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not save that.',
        );
      } finally {
        setSaving(false);
      }
    },
    [chapterId, pinned],
  );

  if (error && !sources) {
    return <p className="text-warn">{error}</p>;
  }
  if (!sources) return <p>Loading sources…</p>;

  // Only a source with something to quote is worth pinning; the rest would filter retrieval down
  // to nothing and look like a broken suggestion.
  const usable = sources.filter((s) => s.groundingLevel !== 'NONE');
  const pending = sources.filter((s) => s.status === 'PENDING').length;
  const unusable = sources.length - usable.length - pending;

  if (sources.length === 0) {
    return (
      <div className="space-y-2">
        <p>
          No papers yet. Find papers for this thesis, or add your own PDFs — suggestions cite only
          what is in your library.
        </p>
        <Link
          href={`/app/d/${documentId}/sources?tab=discover`}
          data-testid="find-papers"
          className="inline-block rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink hover:bg-accent-hover"
        >
          Find papers
        </Link>{' '}
        <Link href={`/app/d/${documentId}/sources`} className="inline-block underline">
          Add PDFs
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p>
        {pinned.size === 0
          ? 'Suggestions draw on every source in the library. Pin some to narrow this chapter.'
          : `Suggestions for this chapter draw only on ${pinned.size} pinned ${
              pinned.size === 1 ? 'source' : 'sources'
            }.`}
      </p>

      <div className="flex gap-3 text-xs">
        <button
          type="button"
          className="underline disabled:opacity-50"
          disabled={saving || usable.length === 0 || pinned.size === usable.length}
          onClick={() => void save(new Set(usable.map((s) => s.id)))}
        >
          Pin all
        </button>
        <button
          type="button"
          className="underline disabled:opacity-50"
          disabled={saving || pinned.size === 0}
          onClick={() => void save(new Set())}
        >
          Clear
        </button>
      </div>

      {error ? <p className="text-xs text-warn">{error}</p> : null}

      <ul className="space-y-2">
        {usable.map((source) => (
          <li key={source.id} className="flex gap-2">
            <input
              type="checkbox"
              id={`pin-${source.id}`}
              className="mt-1 shrink-0"
              checked={pinned.has(source.id)}
              onChange={(e) => {
                const next = new Set(pinned);
                if (e.target.checked) next.add(source.id);
                else next.delete(source.id);
                void save(next);
              }}
            />
            <label htmlFor={`pin-${source.id}`} className="text-ink">
              <span className="block leading-snug">
                {source.title ?? source.rawReference ?? 'Untitled source'}
              </span>
              <span className="text-xs text-muted">
                {source.year ? `${source.year} · ` : ''}
                {source.groundingLevel === 'FULL_TEXT' ? 'Full text' : 'Abstract only'}
              </span>
            </label>
          </li>
        ))}
      </ul>

      {pending > 0 ? (
        <p className="text-xs text-muted">
          Still looking up {pending} {pending === 1 ? 'reference' : 'references'}.
        </p>
      ) : null}

      {unusable > 0 ? (
        <p className="text-xs text-muted">
          {unusable} {unusable === 1 ? 'source has' : 'sources have'} nothing to quote, so
          {unusable === 1 ? ' it cannot' : ' they cannot'} be pinned.
        </p>
      ) : null}

      <Link href={`/app/d/${documentId}/sources`} className="inline-block text-xs underline">
        Open the library
      </Link>
    </div>
  );
}
