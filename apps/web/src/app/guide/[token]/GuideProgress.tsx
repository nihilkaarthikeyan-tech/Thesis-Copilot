'use client';

/**
 * What a supervisor sees first — where the thesis is, and what moved (2026-09-21).
 *
 * Before this, opening a shared thesis gave a guide a chapter list identical on every visit, and
 * no way to tell a chapter rewritten last night from one untouched since March. A supervisor's
 * first question is not "show me chapter one", it is "what has changed since I last read this?"
 *
 * Carries no AI-usage figure on purpose. The product tracks provenance for every word and could
 * show it here; FR-8.6 makes that the *student's* disclosure to hand over, and putting it in a
 * supervisor's dashboard by default would quietly turn a disclosure tool into a surveillance one.
 */

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

type ChapterProgress = {
  id: string;
  title: string;
  order: number;
  words: number;
  updatedAt: string | null;
  changedSinceLastVisit: boolean;
  openComments: number;
  started: boolean;
};

type Progress = {
  chapters: ChapterProgress[];
  totalWords: number;
  chaptersStarted: number;
  chaptersTotal: number;
  lastVisitedAt: string | null;
  changedCount: number;
  openComments: number;
  headline: string;
};

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—';

export function GuideProgress({
  documentId,
  currentChapterId,
  onOpenChapter,
}: {
  documentId: string;
  currentChapterId: string | null;
  onOpenChapter: (chapterId: string) => void;
}) {
  const [progress, setProgress] = useState<Progress | null>(null);
  /**
   * The in-flight request, cached per document.
   *
   * This call is not idempotent — it records the visit — and React invokes effects twice under
   * StrictMode, so it needs de-duplicating. Two simpler attempts both failed, and in opposite
   * directions:
   *
   *   - A `cancelled` flag alone discards the second *result* while still sending the second
   *     *request*, which consumed the visit window and turned "this is the first time you have
   *     opened it" into "nothing has changed since you last looked".
   *   - A plain "already asked" flag plus that same `cancelled` flag skipped the second request
   *     *and* threw away the first one's answer, so the panel never rendered at all.
   *
   * Caching the promise fixes both: one request per document, and every mount resolves from it.
   */
  const inFlight = useRef<{ documentId: string; promise: Promise<Progress> } | null>(null);

  useEffect(() => {
    if (inFlight.current?.documentId !== documentId) {
      inFlight.current = {
        documentId,
        promise: api<Progress>(`/guide/documents/${documentId}/progress`, {
          method: 'POST',
          body: '{}',
        }),
      };
    }
    inFlight.current.promise.then(setProgress).catch(() => undefined);
  }, [documentId]);

  if (!progress) return null;

  return (
    <section
      data-testid="guide-progress"
      className="mb-4 rounded-md border border-line bg-surface p-3"
    >
      <p className="eyebrow">Where this is up to</p>
      <p className="mt-1 text-sm text-ink">{progress.headline}</p>

      <ol className="mt-3 grid list-none gap-0.5 p-0" data-testid="guide-progress-chapters">
        {progress.chapters.map((chapter) => (
          <li key={chapter.id}>
            <button
              type="button"
              onClick={() => onOpenChapter(chapter.id)}
              aria-current={chapter.id === currentChapterId ? 'true' : undefined}
              className={`flex w-full items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                chapter.id === currentChapterId ? 'bg-sunk font-semibold text-ink' : 'hover:bg-sunk'
              }`}
            >
              <span className="min-w-0 truncate">
                {chapter.order}. {chapter.title}
                {chapter.changedSinceLastVisit ? (
                  <span
                    data-testid="guide-changed"
                    className="ml-2 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-ink"
                  >
                    new
                  </span>
                ) : null}
              </span>
              <span className="tnum shrink-0 text-muted">
                {chapter.started
                  ? `${chapter.words.toLocaleString()} w · ${when(chapter.updatedAt)}`
                  : 'not started'}
                {chapter.openComments > 0 ? ` · ${chapter.openComments} open` : ''}
              </span>
            </button>
          </li>
        ))}
      </ol>

      {progress.lastVisitedAt ? (
        <p className="mt-2 text-xs text-faint">
          You last opened this on {when(progress.lastVisitedAt)}.
        </p>
      ) : null}
    </section>
  );
}
