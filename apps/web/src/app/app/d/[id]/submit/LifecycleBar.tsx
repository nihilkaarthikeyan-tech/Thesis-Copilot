'use client';

/**
 * The thesis lifecycle control (ADR-0043) — the current stage and the moves available from it.
 *
 * The stage is an explicit, validated state on the server; this only shows it and fires the
 * transitions the server says are allowed. A blocked move stays visible with the reason, so the
 * student sees what to do next rather than a missing button.
 */

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/primitives';
import { ApiError, api } from '@/lib/api';

type LifecycleState = 'DRAFTING' | 'IN_REVIEW' | 'REVISING' | 'READY' | 'SUBMITTED';

type Action = {
  event: string;
  to: LifecycleState;
  toLabel: string;
  label: string;
  allowed: boolean;
  reason: string | null;
};

type View = {
  state: LifecycleState;
  label: string;
  submittedAt: string | null;
  actions: Action[];
};

const TONE: Record<LifecycleState, 'neutral' | 'accent' | 'warn' | 'ok'> = {
  DRAFTING: 'neutral',
  IN_REVIEW: 'accent',
  REVISING: 'warn',
  READY: 'accent',
  SUBMITTED: 'ok',
};

export function LifecycleBar({ documentId }: { documentId: string }) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setView(await api<View>(`/documents/${documentId}/lifecycle`));
    } catch (e) {
      setError(e instanceof ApiError ? e.problem.title : 'Could not load the thesis status.');
    }
  }, [documentId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function fire(event: string) {
    setBusy(event);
    setError(null);
    try {
      setView(
        await api<View>(`/documents/${documentId}/lifecycle`, {
          method: 'POST',
          body: JSON.stringify({ event }),
        }),
      );
    } catch (e) {
      setError(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not update.');
    } finally {
      setBusy(null);
    }
  }

  if (!view) return null;

  return (
    <section className="rounded-md border border-line bg-surface p-4" data-testid="lifecycle-bar">
      <div className="flex flex-wrap items-center gap-3">
        <span className="eyebrow">Status</span>
        <Badge tone={TONE[view.state]} data-testid="lifecycle-state">
          {view.label}
        </Badge>
        {view.submittedAt ? (
          <span className="text-xs text-muted">
            Submitted{' '}
            {new Date(view.submittedAt).toLocaleDateString(undefined, {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </span>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {view.actions.map((a) => (
          <button
            key={a.event}
            type="button"
            disabled={!a.allowed || busy !== null}
            onClick={() => void fire(a.event)}
            title={a.reason ?? `Move to “${a.toLabel}”`}
            className="rounded-sm border border-line px-3 py-1.5 text-sm font-medium hover:bg-sunk disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === a.event ? 'Working…' : a.label}
          </button>
        ))}
      </div>

      {view.actions.some((a) => !a.allowed && a.reason) ? (
        <ul className="mt-2 space-y-0.5 text-xs text-muted">
          {view.actions
            .filter((a) => !a.allowed && a.reason)
            .map((a) => (
              <li key={a.event}>
                <span className="font-medium">{a.label}:</span> {a.reason}
              </li>
            ))}
        </ul>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-sm text-warn">
          {error}
        </p>
      ) : null}
    </section>
  );
}
