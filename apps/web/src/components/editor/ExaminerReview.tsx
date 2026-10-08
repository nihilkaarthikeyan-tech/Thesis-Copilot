'use client';

/**
 * The "Examiner review" button on the Flags tab — ADR-0056.
 *
 * One press reviews the chapter open in the editor: a strict examiner reads each section against
 * the passages its citations point at, and every issue it finds arrives as a flag in the list
 * below, with its severity and a suggested correction. Nothing here edits the chapter.
 *
 * The review runs as a job for a minute or two, so the button polls its state and shows how long
 * it has been running; a student who leaves and comes back finds it still running, or finished.
 *
 * A review of one paragraph or a selection (ADR-0067; R26, ADR-0126) starts here too, from a
 * `request` the block menu or the selection toolbar sends: one COMMAND unit, the same polling, and
 * the same opening of its points in the text when it finishes. It used to be started by the editor
 * screen behind this component's back, so a Flags tab that was already open never saw it run.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { type BlockCheckRequest, takeBlockCheck } from '@/lib/block-check';
import {
  type ExaminerReviewState,
  elapsed,
  resultLine,
  isReviewRunning as running,
} from '@/lib/examiner-review';
import { JOB_EMAIL_NOTE, useJobEmailSetting, watchingParam } from '@/lib/job-watch';

const POLL_MS = 3_000;

export function ExaminerReview({
  chapterId,
  onFinished,
  request,
  save,
  onNotice,
}: {
  chapterId: string;
  /** Reloads the flag list once the review has written its flags. */
  onFinished: () => void | Promise<void>;
  /** R26: review just this range (a paragraph from the block menu, or a selection). */
  request?: BlockCheckRequest | null;
  /** Saves what is on screen first: the job reads the saved chapter. */
  save?: () => Promise<void>;
  /** The editor's notice line, for a review started from the text rather than this button. */
  onNotice?: (text: string) => void;
}) {
  const [state, setState] = useState<ExaminerReviewState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const wasRunning = useRef(false);
  const emailOn = useJobEmailSetting();
  // Held in a ref so a parent that passes a fresh function each render does not restart polling.
  const finished = useRef(onFinished);
  finished.current = onFinished;
  /**
   * Bumped when a review is started, so a status read that was already on its way (the one this
   * component makes when it mounts) cannot land after the start and say "not running" — that
   * would stop the polling, and the finished review would never open in the text.
   */
  const seq = useRef(0);

  const load = useCallback(async () => {
    const asked = seq.current;
    try {
      // ADR-0058: a visible tab's poll tells the worker someone is looking, so no email.
      const next = await api<ExaminerReviewState>(
        `/chapters/${chapterId}/examiner-review${watchingParam()}`,
      );
      if (asked !== seq.current) return;
      setState(next);
      if (wasRunning.current && !running(next)) void finished.current();
      wasRunning.current = running(next);
    } catch {
      // The status is a convenience; the button still works without it.
    }
  }, [chapterId]);

  useEffect(() => {
    wasRunning.current = false;
    setState(null);
    void load();
  }, [load]);

  const isRunning = running(state);
  useEffect(() => {
    if (!isRunning) return;
    const poll = setInterval(() => void load(), POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [isRunning, load]);

  async function start(range?: { from: number; to: number }, scope?: BlockCheckRequest['scope']) {
    seq.current += 1;
    setStarting(true);
    setError(null);
    try {
      // The job reads the saved chapter, so what is on screen is saved first.
      await save?.();
      const next = await api<ExaminerReviewState>(`/chapters/${chapterId}/examiner-review`, {
        method: 'POST',
        body: range ? JSON.stringify({ from: range.from, to: range.to }) : '{}',
      });
      seq.current += 1;
      setNow(Date.now());
      setState(next);
      wasRunning.current = running(next);
      if (scope) {
        onNotice?.(`The examiner is reading the ${scope}. Its findings appear here as flags.`);
      }
    } catch (e) {
      const message =
        e instanceof ApiError
          ? (e.problem.detail ?? e.problem.title)
          : 'The review could not be started.';
      setError(message);
      if (scope) onNotice?.(message);
      // The read made on mounting was set aside for the start; show the review as it stands.
      void load();
    } finally {
      setStarting(false);
    }
  }

  // R26: a review of one paragraph or a selection, asked for from the text. Once per press.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new request starts a review
  useEffect(() => {
    if (!takeBlockCheck(request, 'examiner')) return;
    void start({ from: request.from, to: request.to }, request.scope);
  }, [request]);

  return (
    <div data-testid="examiner-review" className="mb-4 rounded-md border border-line bg-paper p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[13px] font-medium text-ink">Examiner review</p>
        <button
          type="button"
          disabled={starting || isRunning}
          onClick={() => void start()}
          data-testid="run-examiner-review"
          className="rounded-md px-3 py-1 text-xs disabled:opacity-50 bg-accent text-accent-ink hover:bg-accent-hover font-semibold transition-colors"
        >
          {isRunning
            ? `Reviewing… ${elapsed(state?.startedAt ?? null, now)}`
            : starting
              ? 'Starting…'
              : 'Examiner review'}
        </button>
      </div>
      <p className="mt-1 text-[12px] text-muted">
        A strict examiner reads each section of this chapter against the passages it cites. One
        examiner review from your monthly allowance.
      </p>
      {isRunning && state?.selection ? (
        <p data-testid="examiner-review-scope" className="mt-2 text-[12px] text-muted">
          Reading the selected text only, for one command from your allowance.
        </p>
      ) : null}
      {isRunning && emailOn ? (
        <p data-testid="job-email-note" className="mt-2 text-[12px] text-muted">
          {JOB_EMAIL_NOTE}
        </p>
      ) : null}
      {state?.status === 'DONE' ? (
        <p data-testid="examiner-review-result" className="mt-2 text-[12px] text-ink">
          {resultLine(state)}
        </p>
      ) : null}
      {state?.status === 'FAILED' && state.error ? (
        <p className="mt-2 text-[12px] text-warn">{state.error}</p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-[12px] text-warn">
          {error}
        </p>
      ) : null}
    </div>
  );
}
