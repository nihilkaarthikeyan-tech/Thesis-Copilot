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
import { requestReadBeside } from '@/lib/read-beside';
import { readerHref } from '@/lib/reader';

/** Resolution and indexing run in the background; the panel keeps looking until they settle. */
const POLL_MS = 3_000;
/** An empty library is looked at less often: papers found for it arrive within a minute or so. */
const EMPTY_POLL_MS = 20_000;
/** Dispatched on `window` when something may have added papers (a search for sources started). */
export const LIBRARY_CHANGED = 'tc:library-changed';

type PinnableSource = {
  id: string;
  title: string | null;
  rawReference: string | null;
  year: number | null;
  status: string;
  groundingLevel: 'NONE' | 'ABSTRACT' | 'FULL_TEXT' | string;
  hasFile?: boolean;
};

/**
 * "Read PDF" (2026-10-04): beside the chapter on a wide screen (`ReadBesidePane`). On anything
 * narrower it opens the paper reader in a new tab (ADR-0068) — before, it opened the raw storage
 * link, which a phone downloads rather than shows.
 */
function readPdf(documentId: string, source: PinnableSource): void {
  const label = source.title ? source.title.slice(0, 60) : null;
  if (requestReadBeside({ sourceId: source.id, page: null, label })) return;
  window.open(readerHref(documentId, source.id), '_blank', 'noopener');
}

export function SourcePins({
  documentId,
  chapterId,
  section = null,
}: {
  documentId: string;
  chapterId: string;
  /** ADR-0085: the heading under the cursor, whose own pins can be set here. */
  section?: string | null;
}) {
  const [sources, setSources] = useState<PinnableSource[] | null>(null);
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  /** ADR-0085: the section's own pins, when the cursor is under a heading. */
  const [sectionPinned, setSectionPinned] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<'chapter' | 'section'>('chapter');
  const sectionKey = section?.trim() ?? '';
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [library, pins] = await Promise.all([
        api<PinnableSource[]>(`/documents/${documentId}/sources`),
        api<{ sourceIds: string[]; section?: { sourceIds: string[] } }>(
          `/chapters/${chapterId}/pins${sectionKey ? `?section=${encodeURIComponent(sectionKey)}` : ''}`,
        ),
      ]);
      setSources(library);
      setPinned(new Set(pins.sourceIds));
      setSectionPinned(new Set(pins.section?.sourceIds ?? []));
    } catch (e) {
      setError(
        e instanceof ApiError
          ? (e.problem.detail ?? e.problem.title)
          : 'Could not load the library.',
      );
    }
  }, [documentId, chapterId, sectionKey]);

  useEffect(() => {
    void load();
  }, [load]);

  // Leaving a heading leaves its scope: the chapter's pins are what applies there.
  useEffect(() => {
    if (!sectionKey) setScope('chapter');
  }, [sectionKey]);

  // A source's grounding level is decided by two background jobs, so a panel opened seconds after
  // an upload sees every source as "nothing to quote" and stays wrong until the student reloads.
  // An empty library is also polled: automatic sources (ADR-0037) add papers in the background,
  // and the panel said "No papers yet" while the Sources page already listed five (2026-10-04).
  const settling = sources?.some((s) => s.status === 'PENDING');
  const empty = sources?.length === 0;
  useEffect(() => {
    if (!settling && !empty) return;
    const timer = setInterval(() => void load(), settling ? POLL_MS : EMPTY_POLL_MS);
    return () => clearInterval(timer);
  }, [settling, empty, load]);

  // Coming back to the tab (after adding papers on the Sources page) or the editor saying a
  // search for papers has started both mean the library may have changed.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') void load();
    };
    window.addEventListener('focus', refresh);
    window.addEventListener(LIBRARY_CHANGED, refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener(LIBRARY_CHANGED, refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [load]);

  const save = useCallback(
    async (next: Set<string>) => {
      const forSection = scope === 'section' && sectionKey.length > 0;
      const previous = forSection ? sectionPinned : pinned;
      (forSection ? setSectionPinned : setPinned)(next); // Optimistic: a checkbox that lags feels broken.
      setSaving(true);
      setError(null);
      try {
        await api(`/chapters/${chapterId}/pins`, {
          method: 'PUT',
          body: JSON.stringify({
            sourceIds: [...next],
            ...(forSection ? { section: sectionKey } : {}),
          }),
        });
      } catch (e) {
        (forSection ? setSectionPinned : setPinned)(previous);
        setError(
          e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not save that.',
        );
      } finally {
        setSaving(false);
      }
    },
    [chapterId, pinned, sectionPinned, scope, sectionKey],
  );
  const active = scope === 'section' && sectionKey ? sectionPinned : pinned;

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
      {sectionKey ? (
        <fieldset data-testid="pins-scope" className="flex flex-wrap gap-3 text-xs">
          <legend className="sr-only">Which pins to set</legend>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="pins-scope"
              checked={scope === 'chapter'}
              onChange={() => setScope('chapter')}
            />
            This chapter
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="pins-scope"
              data-testid="pins-scope-section"
              checked={scope === 'section'}
              onChange={() => setScope('section')}
            />
            This section: “{sectionKey.length > 40 ? `${sectionKey.slice(0, 40)}…` : sectionKey}”
          </label>
        </fieldset>
      ) : null}
      <p>
        {scope === 'section' && sectionKey
          ? sectionPinned.size === 0
            ? `This section has no pins of its own, so the chapter’s ${pinned.size === 0 ? 'whole library' : `${pinned.size} pinned`} applies under it. Pin some to narrow this section only.`
            : `Under this heading, suggestions draw only on its ${sectionPinned.size} pinned ${
                sectionPinned.size === 1 ? 'source' : 'sources'
              }; the chapter’s pins do not apply here.`
          : pinned.size === 0
            ? 'Suggestions draw on every source in the library. Pin some to narrow this chapter.'
            : `Suggestions for this chapter draw only on ${pinned.size} pinned ${
                pinned.size === 1 ? 'source' : 'sources'
              }.`}
      </p>

      <div className="flex gap-3 text-xs">
        <button
          type="button"
          className="underline disabled:opacity-50"
          disabled={saving || usable.length === 0 || active.size === usable.length}
          onClick={() => void save(new Set(usable.map((s) => s.id)))}
        >
          Pin all
        </button>
        <button
          type="button"
          className="underline disabled:opacity-50"
          disabled={saving || active.size === 0}
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
              checked={active.has(source.id)}
              onChange={(e) => {
                const next = new Set(active);
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
            <span className="ml-auto flex shrink-0 flex-col items-end gap-0.5 self-start text-xs">
              {source.hasFile ? (
                <button
                  type="button"
                  data-testid="source-read-pdf"
                  className="text-accent underline"
                  onClick={() => readPdf(documentId, source)}
                >
                  Read PDF
                </button>
              ) : null}
              <a
                href={readerHref(documentId, source.id)}
                target="_blank"
                rel="noopener"
                data-testid="source-open-reader"
                className="text-muted underline hover:text-ink"
              >
                Open in reader
              </a>
            </span>
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
