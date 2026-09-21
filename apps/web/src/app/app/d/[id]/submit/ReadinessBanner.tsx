'use client';

/**
 * "Eight of ten, and you have eleven days."
 *
 * The compliance checklist below this has always said what is wrong. What it could not say is
 * whether that mattered *yet*, because nothing knew when the thesis was due. This is the two
 * halves in one sentence, and the date input that makes the second half possible.
 *
 * It adds no new gate. `exportThesis` still owns whether a PDF may be produced; this only reads.
 * A student who has set no date still gets the score — the deadline is an offer, not a
 * requirement, because most people do not know it when they start.
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';

type Readiness = {
  passed: number;
  total: number;
  daysLeft: number | null;
  deadline: string | null;
  urgency: 'none' | 'comfortable' | 'soon' | 'urgent' | 'overdue';
  blocking: Array<{ check: string; label: string; findingCount: number }>;
  headline: string;
  templateName: string;
};

/** Only the two states that mean "act now" get colour. Everything else stays quiet. */
const TONE: Record<Readiness['urgency'], string> = {
  none: 'border-line bg-surface',
  comfortable: 'border-line bg-surface',
  soon: 'border-line-strong bg-sunk',
  urgent: 'border-warn/40 bg-warn-soft',
  overdue: 'border-danger/40 bg-danger-soft',
};

export function ReadinessBanner({
  documentId,
  refreshKey,
}: {
  documentId: string;
  /** Bumped by the parent after a re-check, so the two never disagree on screen. */
  refreshKey?: number;
}) {
  const [data, setData] = useState<Readiness | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Readiness>(`/documents/${documentId}/readiness`)
      .then(setData)
      .catch(() => undefined);
  }, [documentId]);

  // `refreshKey` is a trigger, not a value this reads: the parent bumps it after a re-check so
  // the checklist and this banner cannot disagree on screen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(load, [load, refreshKey]);

  async function setDeadline(deadline: string | null) {
    setBusy(true);
    setError(null);
    try {
      await api(`/documents/${documentId}/deadline`, {
        method: 'PUT',
        body: JSON.stringify({ deadline }),
      });
      load();
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not save that date.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (!data) return null;

  return (
    <section data-testid="readiness" className={`mt-4 rounded-md border p-4 ${TONE[data.urgency]}`}>
      <p className="eyebrow">Ready to submit?</p>
      <p className="mt-1 text-sm text-ink">{data.headline}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor="deadline" className="text-xs text-muted">
          Submission date
        </label>
        <input
          id="deadline"
          type="date"
          disabled={busy}
          data-testid="deadline-input"
          value={data.deadline ?? ''}
          onChange={(e) => void setDeadline(e.target.value || null)}
          className="rounded-md border border-line bg-paper px-2 py-1 text-sm text-ink"
        />
        {data.deadline ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void setDeadline(null)}
            className="text-xs text-muted underline disabled:opacity-50"
          >
            Clear
          </button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-xs text-warn">
          {error}
        </p>
      ) : null}

      {data.blocking.length > 0 ? (
        <>
          <p className="mt-3 text-xs text-muted">
            Longest first — the one with the most to fix is the one to start on.
          </p>
          <ol className="mt-1 grid list-none gap-0.5 p-0 text-xs" data-testid="readiness-blocking">
            {data.blocking.map((check) => (
              <li key={check.check} className="flex items-baseline justify-between gap-2">
                <span className="truncate text-ink">{check.label}</span>
                <span className="tnum shrink-0 text-muted">{check.findingCount} to fix</span>
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </section>
  );
}
