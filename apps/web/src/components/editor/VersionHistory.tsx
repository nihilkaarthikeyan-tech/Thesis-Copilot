'use client';

/**
 * Version history — every saved version of this chapter, readable, and restorable.
 *
 * Snapshots have been written since week 2 (on Ctrl+S, every ten minutes of editing, and before a
 * draft or a revision is accepted) and nothing let a student see one. That is the worst kind of
 * gap: the product was paying to keep the old text and the one person who might want it could not
 * get at it.
 *
 * ## The order of a restore matters
 *
 * 1. Flush the autosave, so the server has what is on screen right now.
 * 2. Restore. The server snapshots its current text as `PRE_RESTORE` before overwriting it — which
 *    is only the student's latest work because of step 1.
 * 3. Reload onto the restored text, carrying the PRE_RESTORE id so the page can offer an undo.
 *
 * Skipping step 1 would make the undo restore a version up to two seconds stale.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { dayLabel, type PreviewBlock, previewBlocks, reasonLabel } from '@/lib/version-preview';

type VersionSummary = {
  id: string;
  reason: string;
  wordCount: number | null;
  createdAt: string;
};

/** Opened, the length is always known: the server counts it from the text when the row has none. */
type VersionView = Omit<VersionSummary, 'wordCount'> & {
  wordCount: number;
  chapterId: string | null;
  content: unknown;
};

type Restored = { chapterId: string; version: number; wordCount: number; undoVersionId: string };

/** Versions per page — the server's `VERSION_LIST_LIMIT`. */
const VERSION_PAGE = 100;

/** The query parameter a reload carries so the editor can offer to undo a restore. */
export const UNDO_PARAM = 'restoredFrom';

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

export function VersionHistory({
  chapterId,
  currentWords,
  save,
  onClose,
}: {
  chapterId: string;
  /** The chapter's length now, so each version can say how different it is. */
  currentWords: number;
  /** Flushes the autosave; called before a restore. */
  save: () => Promise<void>;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<VersionSummary[] | null>(null);
  const [selected, setSelected] = useState<VersionView | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The server sends VERSION_PAGE at a time; a full page means there may be older ones.
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  useEffect(() => {
    api<VersionSummary[]>(`/chapters/${chapterId}/versions`)
      .then((page) => {
        setVersions(page);
        setHasOlder(page.length === VERSION_PAGE);
      })
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.problem.title : 'Could not load the history.'),
      );
  }, [chapterId]);

  async function loadOlder() {
    const last = versions?.at(-1);
    if (!last) return;
    setLoadingOlder(true);
    try {
      const page = await api<VersionSummary[]>(
        `/chapters/${chapterId}/versions?before=${encodeURIComponent(last.id)}`,
      );
      setVersions((current) => [...(current ?? []), ...page]);
      setHasOlder(page.length === VERSION_PAGE);
    } catch (e) {
      setError(e instanceof ApiError ? e.problem.title : 'Could not load older versions.');
    } finally {
      setLoadingOlder(false);
    }
  }

  // Escape closes, as every other overlay in the editor does.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const open = useCallback(async (id: string) => {
    setLoading(id);
    setConfirming(false);
    setError(null);
    try {
      setSelected(await api<VersionView>(`/versions/${id}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.problem.title : 'Could not open that version.');
    } finally {
      setLoading(null);
    }
  }, []);

  const restore = useCallback(async () => {
    if (!selected) return;
    setRestoring(true);
    setError(null);
    try {
      await save();
      const result = await api<Restored>(`/versions/${selected.id}/restore`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const url = new URL(window.location.href);
      url.searchParams.set(UNDO_PARAM, result.undoVersionId);
      window.location.assign(url.toString());
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'The restore failed.',
      );
      setRestoring(false);
    }
  }, [selected, save]);

  /** Grouped by day, newest first, keeping the server's order within a day. */
  const groups = useMemo(() => {
    const out: Array<{ day: string; items: VersionSummary[] }> = [];
    for (const version of versions ?? []) {
      const day = dayLabel(version.createdAt);
      const last = out.at(-1);
      if (last && last.day === day) last.items.push(version);
      else out.push({ day, items: [version] });
    }
    return out;
  }, [versions]);

  const blocks: PreviewBlock[] = useMemo(
    () => (selected ? previewBlocks(selected.content) : []),
    [selected],
  );

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-ink/25"
      data-testid="version-history"
      role="dialog"
      aria-modal="true"
      aria-label="Version history"
    >
      {/* The backdrop closes it; a click inside the sheet does not reach it. */}
      <button
        type="button"
        aria-label="Close history"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div className="relative flex h-full w-full max-w-4xl flex-col border-l border-line bg-surface shadow-2xl sm:flex-row">
        <section className="flex max-h-[40vh] w-full shrink-0 flex-col border-b border-line sm:max-h-none sm:w-72 sm:border-r sm:border-b-0">
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-[16px] font-bold">History</h2>
            <button type="button" className="text-xs text-muted underline" onClick={onClose}>
              Close
            </button>
          </header>
          <div className="flex-1 overflow-y-auto px-2 py-2">
            {versions === null && !error ? (
              <p className="px-2 text-xs text-muted">Loading…</p>
            ) : versions && versions.length === 0 ? (
              <p className="px-2 text-xs text-muted">
                No versions yet. One is saved every ten minutes while you write, and whenever you
                press Ctrl+S.
              </p>
            ) : (
              groups.map((group) => (
                <div key={group.day} className="mb-3">
                  <p className="eyebrow px-2 pb-1">{group.day}</p>
                  <ul className="grid list-none gap-0.5 p-0">
                    {group.items.map((version) => {
                      const active = selected?.id === version.id;
                      const delta =
                        version.wordCount === null ? null : version.wordCount - currentWords;
                      return (
                        <li key={version.id}>
                          <button
                            type="button"
                            data-testid="version-row"
                            aria-current={active}
                            onClick={() => void open(version.id)}
                            className={`w-full rounded-md px-2 py-1.5 text-left transition-colors ${
                              active ? 'bg-accent-soft' : 'hover:bg-sunk'
                            }`}
                          >
                            <span className="flex items-baseline justify-between gap-2 text-[13px]">
                              <span className="tnum font-semibold text-ink">
                                {time(version.createdAt)}
                              </span>
                              <span className="tnum text-xs text-muted">
                                {version.wordCount === null
                                  ? ''
                                  : `${version.wordCount.toLocaleString()} words`}
                              </span>
                            </span>
                            <span className="flex items-baseline justify-between gap-2 text-xs text-muted">
                              <span>{reasonLabel(version.reason)}</span>
                              {delta !== null && delta !== 0 ? (
                                <span className="tnum">
                                  {delta > 0 ? `+${delta}` : delta} vs now
                                </span>
                              ) : null}
                            </span>
                            {loading === version.id ? (
                              <span className="text-xs text-muted">Opening…</span>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))
            )}
            {hasOlder ? (
              <button
                type="button"
                data-testid="versions-older"
                disabled={loadingOlder}
                onClick={() => void loadOlder()}
                className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-xs font-semibold text-accent hover:bg-sunk disabled:opacity-50"
              >
                {loadingOlder ? 'Loading…' : 'Show older versions'}
              </button>
            ) : null}
          </div>
        </section>

        <section className="flex min-h-0 flex-1 flex-col">
          {selected ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
                <p className="text-sm text-muted">
                  {dayLabel(selected.createdAt)} at {time(selected.createdAt)} ·{' '}
                  {selected.wordCount.toLocaleString()} words · {reasonLabel(selected.reason)}
                </p>
                {confirming ? (
                  <span className="flex items-center gap-2 text-xs">
                    <span className="text-muted">
                      Your current text is saved as a version first, so this can be undone.
                    </span>
                    <button
                      type="button"
                      data-testid="version-restore-confirm"
                      disabled={restoring}
                      onClick={() => void restore()}
                      className="rounded-md bg-accent px-2.5 py-1 font-semibold text-accent-ink disabled:opacity-50"
                    >
                      {restoring ? 'Restoring…' : 'Restore'}
                    </button>
                    <button
                      type="button"
                      className="text-muted underline"
                      onClick={() => setConfirming(false)}
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    data-testid="version-restore"
                    onClick={() => setConfirming(true)}
                    className="rounded-md border border-line-strong px-2.5 py-1 text-xs font-semibold text-ink hover:bg-sunk"
                  >
                    Restore this version
                  </button>
                )}
              </div>
              <article
                data-testid="version-preview"
                className="flex-1 overflow-y-auto px-6 py-5 font-serif text-[15px] leading-relaxed text-ink"
              >
                {blocks.length === 0 ? (
                  <p className="text-muted">This version was empty.</p>
                ) : (
                  blocks.map((block, index) => {
                    // Blocks have no ids of their own and never reorder within one render.
                    const key = `${index}-${block.kind}`;
                    if (block.kind === 'heading') {
                      return (
                        <p
                          key={key}
                          className={`mt-4 font-semibold ${block.level === 1 ? 'text-[20px]' : 'text-[16px]'}`}
                        >
                          {block.text}
                        </p>
                      );
                    }
                    if (block.kind === 'object') {
                      return (
                        <p
                          key={key}
                          className="my-3 rounded-md border border-dashed border-line px-3 py-2 font-sans text-xs text-muted"
                        >
                          {block.text}
                        </p>
                      );
                    }
                    return (
                      <p key={key} className={block.kind === 'item' ? 'mt-1 pl-4' : 'mt-3'}>
                        {block.kind === 'item' ? '• ' : ''}
                        {block.text}
                      </p>
                    );
                  })
                )}
              </article>
            </>
          ) : (
            <p className="m-auto max-w-sm px-6 text-center text-sm text-muted">
              Pick a version to read it. Nothing changes until you choose to restore one.
            </p>
          )}
          {error ? (
            <p
              role="alert"
              className="border-t border-warn/30 bg-warn/10 px-4 py-2 text-xs text-warn"
            >
              {error}
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
