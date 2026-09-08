'use client';

/**
 * `/admin/users/:id` — PHASES 5.9.
 *
 *   "per-user page with their documents (titles only), usage, cost, last active; 'reset caps'
 *    button (logged)"
 *
 * The reset asks once, then shows what it zeroed; the audit row it writes is listed below, with
 * the admin who did it. Plan changes for pilot accounts (PHASES 5.8) live here too.
 */

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { inr, type UserRow, when } from '../shared';

type UserDetail = UserRow & {
  documentList: Array<{ id: string; title: string; updatedAt: string; chapters: number }>;
  capExceeded: number;
  recentEvents: Array<{
    kind: string;
    actorId: string | null;
    detail: unknown;
    createdAt: string;
  }>;
};

const PLANS = ['FREE_TRIAL', 'STUDENT_MONTHLY', 'STUDENT_ANNUAL', 'INSTITUTION_SEAT'] as const;

export default function AdminUserPage() {
  const { id } = useParams<{ id: string }>();
  const [user, setUser] = useState<UserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<UserDetail>(`/admin/users/${id}`)
      .then(setUser)
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.problem.title : 'Could not load the user.'),
      );
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function resetCaps() {
    if (!user) return;
    if (!window.confirm(`Reset this month's caps for ${user.email}? This is logged.`)) return;
    setBusy(true);
    try {
      const result = await api<{ reset: Array<{ action: string; was: number }> }>(
        `/admin/users/${id}/reset-caps`,
        { method: 'POST', body: '{}' },
      );
      setNotice(
        result.reset.length === 0
          ? 'Nothing to reset: every counter was already at zero.'
          : `Reset: ${result.reset.map((r) => `${r.action} was ${r.was}`).join(', ')}.`,
      );
      load();
    } catch (e) {
      setError(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Reset failed.');
    } finally {
      setBusy(false);
    }
  }

  async function setPlan(plan: string) {
    setBusy(true);
    try {
      await api(`/admin/users/${id}/plan`, { method: 'PUT', body: JSON.stringify({ plan }) });
      setNotice(`Plan set to ${plan}.`);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Change failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <nav className="text-xs text-muted">
        <Link href="/admin" className="hover:underline">
          Admin
        </Link>{' '}
        /{' '}
        <Link href="/admin/users" className="hover:underline">
          Users
        </Link>{' '}
        / {user?.email ?? '…'}
      </nav>

      {error ? (
        <p role="alert" className="mt-4 text-sm text-warn">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" data-testid="admin-notice" className="mt-4 text-sm">
          {notice}
        </p>
      ) : null}

      {user ? (
        <>
          <h1 className="mt-2 text-balance font-serif text-[27px] font-semibold leading-tight text-ink">
            {user.email}
          </h1>
          <p className="text-sm text-muted">
            {user.name || 'No name'} · {user.role} · joined {when(user.createdAt)} · last active{' '}
            {when(user.lastActiveAt)}
          </p>

          <section className="mt-8 grid gap-4 md:grid-cols-2">
            <div className="rounded-md border border-line bg-surface p-4 text-sm">
              <p className="text-xs text-muted">This month</p>
              <ul className="mt-2 space-y-1" data-testid="user-usage">
                {user.usage
                  .filter((x) => x.cap > 0 || x.used > 0)
                  .map((x) => (
                    <li key={x.action} className="flex justify-between">
                      <span>{x.action}</span>
                      <span className={x.used >= x.cap && x.cap > 0 ? 'text-warn' : ''}>
                        {x.used} / {x.cap}
                      </span>
                    </li>
                  ))}
                <li className="flex justify-between border-t border-line pt-1">
                  <span>Cost</span>
                  <span className={user.costInr > 100 ? 'text-warn' : ''}>{inr(user.costInr)}</span>
                </li>
                <li className="flex justify-between">
                  <span>Cap refusals</span>
                  <span>{user.capExceeded}</span>
                </li>
              </ul>
              <button
                type="button"
                disabled={busy}
                onClick={() => void resetCaps()}
                className="mt-3 rounded-md border border-line-strong bg-surface px-3 py-1 text-xs font-semibold text-ink transition-colors hover:bg-sunk"
              >
                Reset caps
              </button>
            </div>

            <div className="rounded-md border border-line bg-surface p-4 text-sm">
              <p className="text-xs text-muted">Plan</p>
              <p className="mt-2 font-mono">{user.plan}</p>
              <label className="mt-3 block text-xs text-muted" htmlFor="plan">
                Change plan (logged)
              </label>
              <select
                id="plan"
                disabled={busy}
                value={user.plan}
                onChange={(e) => void setPlan(e.target.value)}
                className="mt-1 rounded-md border border-line-strong bg-surface px-2 py-1 text-sm font-semibold text-ink transition-colors hover:bg-sunk"
              >
                {PLANS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </section>

          <section className="mt-8">
            <h2 className="text-balance font-serif text-[17px] font-semibold leading-snug text-ink">
              Theses
            </h2>
            {user.documentList.length === 0 ? (
              <p className="mt-2 text-sm text-muted">None yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line rounded-md border border-line bg-surface text-sm">
                {user.documentList.map((d) => (
                  <li key={d.id} className="flex justify-between px-4 py-2">
                    <span>{d.title}</span>
                    <span className="text-xs text-muted">
                      {d.chapters} chapter{d.chapters === 1 ? '' : 's'} · {when(d.updatedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-8">
            <h2 className="text-balance font-serif text-[17px] font-semibold leading-snug text-ink">
              Recent admin actions and feedback
            </h2>
            {user.recentEvents.length === 0 ? (
              <p className="mt-2 text-sm text-muted">Nothing logged.</p>
            ) : (
              <ul
                className="mt-2 divide-y divide-line rounded-md border border-line bg-surface text-sm"
                data-testid="user-events"
              >
                {user.recentEvents.map((e) => (
                  <li key={`${e.kind}-${e.createdAt}`} className="px-4 py-2">
                    <span className="font-mono text-xs">{e.kind}</span>{' '}
                    <span className="text-xs text-muted">{when(e.createdAt)}</span>
                    {e.actorId ? (
                      <span className="text-xs text-muted"> · by {e.actorId.slice(0, 8)}…</span>
                    ) : null}
                    <pre className="mt-1 whitespace-pre-wrap text-xs text-muted">
                      {JSON.stringify(e.detail)}
                    </pre>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : !error ? (
        <p className="mt-6 text-sm text-muted">Loading…</p>
      ) : null}
    </main>
  );
}
