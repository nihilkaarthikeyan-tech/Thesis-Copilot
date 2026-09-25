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

/** How often an open page re-reads the thesis (2026-09-25, the live view). */
const REFRESH_MS = 60_000;

type ChapterProgress = {
  id: string;
  title: string;
  order: number;
  words: number;
  updatedAt: string | null;
  changedSinceLastVisit: boolean;
  openComments: number;
  started: boolean;
  activeNow?: boolean;
};

type WeekWords = { weekStart: string; words: number; partial: boolean };

type Progress = {
  chapters: ChapterProgress[];
  totalWords: number;
  chaptersStarted: number;
  chaptersTotal: number;
  lastVisitedAt: string | null;
  changedCount: number;
  openComments: number;
  headline: string;
  weekly?: WeekWords[];
  lastActiveAt?: string | null;
};

/** "3 minutes ago", "yesterday", "12 Sept": how long ago the student last wrote. */
const ago = (iso: string, now: number) => {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  if (hours < 48) return 'yesterday';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
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

  /**
   * The live part: re-read every minute while the page is in front of the supervisor. The GET
   * never records a visit, and it is told which visit this page was opened against, so what
   * changed stays what changed — and a chapter the student saves while the supervisor watches
   * joins the list.
   */
  const [refreshedAt, setRefreshedAt] = useState(() => Date.now());
  const openedAt = useRef(new Date().toISOString());
  useEffect(() => {
    if (!progress) return;
    const since = progress.lastVisitedAt ?? openedAt.current;
    const firstVisit = progress.lastVisitedAt === null;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      api<Progress>(`/guide/documents/${documentId}/progress?since=${encodeURIComponent(since)}`)
        .then((next) => {
          setRefreshedAt(Date.now());
          setProgress((current) => ({
            ...next,
            // A first visit keeps its own sentence until something actually moves.
            lastVisitedAt: current?.lastVisitedAt ?? null,
            headline:
              firstVisit && next.changedCount === 0 && current ? current.headline : next.headline,
          }));
        })
        .catch(() => undefined);
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [documentId, progress]);

  if (!progress) return null;
  const writingNow = progress.chapters.filter((c) => c.activeNow);
  const weekly = progress.weekly ?? [];

  return (
    <section
      data-testid="guide-progress"
      className="mb-4 rounded-md border border-line bg-surface p-3"
    >
      <p className="flex items-center justify-between gap-2">
        <span className="eyebrow">Where this is up to</span>
        <span className="text-[10px] text-faint" data-testid="guide-live">
          <span
            aria-hidden
            className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-ok align-middle"
          />
          Live · checked {ago(new Date(refreshedAt).toISOString(), Date.now())}
        </span>
      </p>
      <p className="mt-1 text-sm text-ink">{progress.headline}</p>
      {writingNow.length > 0 ? (
        <p className="mt-1 text-xs font-semibold text-ok" data-testid="guide-writing-now">
          Writing now: {writingNow.map((c) => c.title).join(', ')}
        </p>
      ) : progress.lastActiveAt ? (
        <p className="mt-1 text-xs text-muted">
          Last written to {ago(progress.lastActiveAt, Date.now())}.
        </p>
      ) : null}
      {weekly.some((w) => w.words > 0) ? <WordsOverTime weeks={weekly} /> : null}

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
                {chapter.activeNow ? (
                  <span
                    className="ml-2 inline-block h-1.5 w-1.5 rounded-full bg-ok align-middle"
                    title="Being written now"
                  />
                ) : null}
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

/**
 * Words in the thesis at the end of each of the last eight weeks, from the counts autosave kept.
 * A week whose count is incomplete is drawn hatched and said to be, not drawn as a fall.
 */
function WordsOverTime({ weeks }: { weeks: WeekWords[] }) {
  const max = Math.max(1, ...weeks.map((w) => w.words));
  const last = weeks.at(-1);
  const before = weeks.at(-2);
  const delta = last && before && !before.partial ? last.words - before.words : null;
  const label = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return (
    <figure className="mt-3" data-testid="guide-words-over-time">
      <figcaption className="flex justify-between text-[11px] text-muted">
        <span>Words, week by week</span>
        {delta !== null ? (
          <span className="tnum">
            {delta >= 0 ? '+' : '−'}
            {Math.abs(delta).toLocaleString()} this week
          </span>
        ) : null}
      </figcaption>
      <svg
        viewBox={`0 0 ${weeks.length * 12} 40`}
        className="mt-1 h-10 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={weeks
          .map((w) => `week of ${label(w.weekStart)}: ${w.words.toLocaleString()} words`)
          .join('; ')}
      >
        {weeks.map((w, i) => {
          const h = Math.max(1, (w.words / max) * 38);
          return (
            <rect
              key={w.weekStart}
              x={i * 12 + 1}
              y={40 - h}
              width={10}
              height={h}
              rx={1}
              className={
                w.partial
                  ? 'fill-line-strong'
                  : i === weeks.length - 1
                    ? 'fill-accent'
                    : 'fill-faint'
              }
            >
              <title>
                {`Week of ${label(w.weekStart)}: ${w.words.toLocaleString()} words${w.partial ? ' (incomplete record)' : ''}`}
              </title>
            </rect>
          );
        })}
      </svg>
      <div className="flex justify-between text-[10px] text-faint">
        <span>{label(weeks[0]?.weekStart ?? '')}</span>
        <span>this week</span>
      </div>
      {weeks.some((w) => w.partial) ? (
        <p className="mt-1 text-[10px] text-faint">
          Pale bars: weeks from before word counts were recorded, so the true figure may be higher.
        </p>
      ) : null}
    </figure>
  );
}
