'use client';

/**
 * `/admin/users` — every account, a page at a time (PHASES 5.9; filters 2026-09-29).
 *
 * Search by email or name, narrow by plan, role or status. One row per account: plan, status,
 * theses, this month's use against the cap (plus any extra allowance), cost, last activity.
 * The filters live in the address, so a filtered list can be bookmarked or sent to a colleague.
 */

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import {
  ago,
  day,
  inr,
  PLAN_NAMES,
  planName,
  ROLE_NAMES,
  roleName,
  StatusBadge,
} from '@/components/admin/kit';
import { Pager } from '@/components/ui/pager';
import { Input, PageHeader, Select } from '@/components/ui/primitives';
import { actionName } from '@/lib/action-names';
import { isSessionGone, signInUrlFor } from '@/lib/admin-gate';
import { ApiError, api } from '@/lib/api';
import type { UserRow } from './shared';

/** Accounts per page; the API's default and within its 200 maximum. */
const PAGE = 50;

const STATUS_NAMES: Record<string, string> = {
  active: 'Active',
  suspended: 'Suspended',
  deleting: 'Deletion pending',
  deleted: 'Deleted',
};

function UsersList() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const q = params.get('q') ?? '';
  const plan = params.get('plan') ?? '';
  const role = params.get('role') ?? '';
  const status = params.get('status') ?? '';
  const offset = Number(params.get('offset') ?? 0) || 0;

  const [search, setSearch] = useState(q);
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  function update(next: Record<string, string | number>) {
    const merged = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === '' || value === 0) merged.delete(key);
      else merged.set(key, String(value));
    }
    if (!('offset' in next)) merged.delete('offset');
    const query = merged.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  // Typing searches after a short pause, rather than on every key.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the typed text should trigger it
  useEffect(() => {
    if (search === q) return;
    const timer = setTimeout(() => update({ q: search.trim() }), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const query = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
    if (q) query.set('q', q);
    if (plan) query.set('plan', plan);
    if (role) query.set('role', role);
    if (status) query.set('status', status);
    api<{ rows: UserRow[]; total: number }>(`/admin/users?${query}`)
      .then((page) => {
        setUsers(page.rows);
        setTotal(page.total);
        setError(null);
      })
      .catch((e: unknown) => {
        if (isSessionGone(e)) router.replace(signInUrlFor('/admin/users'));
        else setError(e instanceof ApiError ? e.problem.title : 'Could not load the users.');
      });
  }, [router, q, plan, role, status, offset]);

  const filtered = Boolean(q || plan || role || status);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
      <PageHeader
        title="Users"
        lede={
          users
            ? `${total.toLocaleString('en-IN')} ${filtered ? 'matching ' : ''}account${total === 1 ? '' : 's'}. Click one to manage it.`
            : 'Every account on the site.'
        }
      />

      <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto_auto]">
        <label className="sr-only" htmlFor="user-search">
          Search by email or name
        </label>
        <Input
          id="user-search"
          type="search"
          placeholder="Search by email or name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="admin-user-search"
        />
        <Select aria-label="Plan" value={plan} onChange={(e) => update({ plan: e.target.value })}>
          <option value="">Plan: all</option>
          {Object.entries(PLAN_NAMES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Select aria-label="Role" value={role} onChange={(e) => update({ role: e.target.value })}>
          <option value="">Role: all</option>
          {Object.entries(ROLE_NAMES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Status"
          value={status}
          onChange={(e) => update({ status: e.target.value })}
          data-testid="admin-user-status"
        >
          <option value="">Status: all</option>
          {Object.entries(STATUS_NAMES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>

      {error ? (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {users ? (
        users.length === 0 ? (
          <p className="mt-6 text-sm text-muted">
            No account matches.{' '}
            {filtered ? (
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setSearch('');
                  router.replace(pathname);
                }}
              >
                Clear the filters
              </button>
            ) : null}
          </p>
        ) : (
          <>
            <div className="relative mt-4 overflow-x-auto rounded-md border border-line bg-surface">
              <table className="w-full min-w-[52rem] text-sm" data-testid="admin-users">
                <thead className="text-left text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2">Account</th>
                    <th className="px-3 py-2">Plan</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Theses</th>
                    <th className="px-3 py-2">This month</th>
                    <th className="px-3 py-2">Cost</th>
                    <th className="px-3 py-2">Last active</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const busiest = [...u.usage]
                      .filter((x) => x.used > 0)
                      .sort((a, b) => b.used / (b.cap || 1) - a.used / (a.cap || 1))
                      .slice(0, 2);
                    const bonus = u.usage.reduce((n, x) => n + (x.bonus ?? 0), 0);
                    return (
                      <tr key={u.id} className="border-t border-line align-top">
                        <td className="px-3 py-2">
                          <Link
                            href={`/admin/users/${u.id}`}
                            className="font-semibold text-ink hover:underline"
                          >
                            {u.email}
                          </Link>
                          <p className="text-xs text-muted">
                            {[u.name, u.role !== 'STUDENT' ? roleName(u.role) : null]
                              .filter(Boolean)
                              .join(' · ')}
                            {u.name || u.role !== 'STUDENT' ? ' · ' : ''}joined {day(u.createdAt)}
                          </p>
                        </td>
                        <td className="px-3 py-2">
                          {planName(u.plan)}
                          {bonus > 0 ? (
                            <span className="block text-xs text-accent">+{bonus} extra</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge status={u.status} />
                        </td>
                        <td className="tnum px-3 py-2">{u.documents}</td>
                        <td className="px-3 py-2 text-xs">
                          {busiest.length === 0 ? (
                            <span className="text-muted">—</span>
                          ) : (
                            busiest.map((x) => (
                              <span
                                key={x.action}
                                className={`block ${x.cap > 0 && x.used >= x.cap ? 'text-warn' : ''}`}
                              >
                                {actionName(x.action)} {x.used}/{x.cap}
                              </span>
                            ))
                          )}
                        </td>
                        <td className={`tnum px-3 py-2 ${u.costInr > 100 ? 'text-danger' : ''}`}>
                          {inr(u.costInr)}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted">{ago(u.lastActiveAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pager
              offset={offset}
              limit={PAGE}
              total={total}
              onChange={(next) => update({ offset: next })}
              noun="accounts"
            />
          </>
        )
      ) : !error ? (
        <p className="mt-6 text-sm text-muted">Loading…</p>
      ) : null}
    </main>
  );
}

export default function AdminUsersPage() {
  // `useSearchParams` needs a Suspense boundary for the static build.
  return (
    <Suspense fallback={<main className="px-6 py-10 text-sm text-muted">Loading…</main>}>
      <UsersList />
    </Suspense>
  );
}
