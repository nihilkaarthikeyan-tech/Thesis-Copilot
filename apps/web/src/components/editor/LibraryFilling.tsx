'use client';

/**
 * The line that says what the library is doing while it fills (ADR-0070, 2026-10-05).
 *
 * A new thesis starts a search for papers the moment it is created. Before this line, the student
 * reached the editor, pressed Suggest, and got nothing and no word on why for the best part of a
 * minute — "stuck in a queue", as a manager put it. Now the editor says what is happening
 * ("Found 5 papers · reading 3…"), and when the student has already asked for a suggestion, the
 * first one is asked for again by itself as soon as a paper can be cited.
 *
 * Counts only, from `GET /documents/:id/sources/progress`: free, no model call. It polls only while
 * something is moving and stops when the library is settled.
 */

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/i18n/react';
import { api } from '@/lib/api';
import { LIBRARY_CHANGED } from './SourcePins';

type Progress = { searching: boolean; found: number; ready: number; reading: number };

/** Fired by the editor when a suggestion came back "papers still loading". */
export const PAPERS_AWAITED = 'tc:papers-awaited';

const POLL_MS = 3_000;
/** How long "N papers ready" stays up after the library settles. */
const READY_MS = 8_000;

export function LibraryFilling({
  documentId,
  onFirstReady,
}: {
  documentId: string;
  /** The student asked for a suggestion while nothing could be cited, and now something can. */
  onFirstReady: () => void;
}) {
  const { t } = useT();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [justReady, setJustReady] = useState(false);
  /** Set while the student is waiting on a suggestion the empty library could not give. */
  const awaited = useRef(false);
  const lastReady = useRef<number | null>(null);
  /** How many papers could be cited when the student's suggestion came back without a citation. */
  const readyWhenAsked = useRef(0);
  const [poll, setPoll] = useState(0);
  const onReadyRef = useRef(onFirstReady);
  onReadyRef.current = onFirstReady;

  useEffect(() => {
    const wake = () => {
      awaited.current = true;
      readyWhenAsked.current = lastReady.current ?? 0;
      setPoll((n) => n + 1);
    };
    const changed = () => setPoll((n) => n + 1);
    window.addEventListener(PAPERS_AWAITED, wake);
    window.addEventListener(LIBRARY_CHANGED, changed);
    return () => {
      window.removeEventListener(PAPERS_AWAITED, wake);
      window.removeEventListener(LIBRARY_CHANGED, changed);
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `poll` restarts the loop on purpose.
  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    const tick = async () => {
      const next = await api<Progress>(`/documents/${documentId}/sources/progress`).catch(
        () => null,
      );
      if (stopped || !next) return;
      setProgress(next);
      const before = lastReady.current;
      lastReady.current = next.ready;
      if (before !== null && next.ready > before) {
        window.dispatchEvent(new Event(LIBRARY_CHANGED));
        if (before === 0) {
          setJustReady(true);
          window.setTimeout(() => setJustReady(false), READY_MS);
        }
      }
      // The student is waiting on a suggestion the library could not cite: ask again as soon as
      // more papers can be cited than when they asked, or once nothing more is on its way.
      const settled = !next.searching && next.reading === 0;
      if (awaited.current && next.ready > 0 && (next.ready > readyWhenAsked.current || settled)) {
        awaited.current = false;
        onReadyRef.current();
      }
      const moving = next.searching || next.reading > 0 || (awaited.current && next.ready === 0);
      if (moving) timer = window.setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [documentId, poll]);

  if (!progress) return null;
  let text: string | null = null;
  if (progress.searching && progress.found === 0) text = t('editor.filling.searching');
  else if (progress.reading > 0)
    text = t('editor.filling.reading', { found: progress.found, reading: progress.reading });
  else if (justReady) text = t('editor.filling.ready', { ready: progress.ready });
  if (!text) return null;
  const busy = progress.searching || progress.reading > 0;
  return (
    <div
      data-testid="library-filling"
      role="status"
      aria-live="polite"
      className="mx-auto mb-3 flex max-w-[72ch] items-center gap-2 rounded-md border border-line bg-sunk px-3 py-2 text-xs text-muted"
    >
      {busy ? (
        <span
          aria-hidden="true"
          className="inline-block h-2.5 w-2.5 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent motion-reduce:animate-none"
        />
      ) : (
        <span aria-hidden="true" className="inline-block h-2 w-2 shrink-0 rounded-full bg-accent" />
      )}
      <span>{text}</span>
    </div>
  );
}
