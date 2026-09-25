'use client';

/**
 * `/admin/users` — PHASES 5.9, "the human can see each pilot student's usage".
 *
 * One row per account: plan, this month's usage against caps, cost, last activity. Titles and
 * text stay off this screen; the per-user page shows document titles and nothing more.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { actionName } from '@/lib/action-names';
import { ApiError, api } from '@/lib/api';
import { inr, type UserRow, when } from './shared';

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ rows: UserRow[]; total: number }>('/admin/users')
      .then((page) => {
        setUsers(page.rows);
        setTotal(page.total);
      })
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.problem.title : 'Could not load the users.'),
      );
  }, []);

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <nav className="text-xs text-muted">
        <Link href="/admin" className="hover:underline">
          Admin
        </Link>{' '}
        / Users
      </nav>
      <h1 className="mt-2 text-balance font-serif text-[27px] font-semibold leading-tight text-ink">
        Pilot students
      </h1>
      {error ? (
        <p role="alert" className="mt-4 text-sm text-warn">
          {error}
        </p>
      ) : null}
      {users ? (
        <>
          {/* The list is a page now, so saying how many of how many is not decoration. */}
          <p className="mt-4 text-[12.5px] text-muted">
            {total > users.length
              ? `Showing the ${users.length} newest of ${total} students.`
              : `${total} ${total === 1 ? 'student' : 'students'}.`}
          </p>
          <div className="mt-2 overflow-x-auto rounded-md border border-line bg-surface">
            <table className="w-full text-sm" data-testid="admin-users">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="px-3 py-2">Student</th>
                  <th className="px-3 py-2">Plan</th>
                  <th className="px-3 py-2">Theses</th>
                  <th className="px-3 py-2">This month</th>
                  <th className="px-3 py-2">Cost</th>
                  <th className="px-3 py-2">Last active</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t border-line">
                    <td className="px-3 py-2">
                      <Link href={`/admin/users/${u.id}`} className="font-medium hover:underline">
                        {u.email}
                      </Link>
                      {u.role !== 'STUDENT' ? (
                        <span className="ml-2 text-xs text-muted">{u.role}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{u.plan}</td>
                    <td className="px-3 py-2">{u.documents}</td>
                    <td className="px-3 py-2 text-xs">
                      {u.usage
                        .filter((x) => x.cap > 0 || x.used > 0)
                        .map((x) => `${actionName(x.action)} ${x.used}/${x.cap}`)
                        .join(' · ')}
                    </td>
                    <td className={`px-3 py-2 ${u.costInr > 100 ? 'text-warn' : ''}`}>
                      {inr(u.costInr)}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted">{when(u.lastActiveAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : !error ? (
        <p className="mt-6 text-sm text-muted">Loading…</p>
      ) : null}
    </main>
  );
}
