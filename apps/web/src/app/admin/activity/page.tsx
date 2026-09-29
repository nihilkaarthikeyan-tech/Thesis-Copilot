'use client';

/**
 * `/admin/activity` — the activity log (2026-09-29): every administrator action and every
 * sensitive change to an account, newest first. Read from `AuditEvent`, which nothing edits or
 * deletes. The per-call "limit reached" rows are left out unless that kind is picked by name,
 * because on a busy day they would bury everything else.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { byWhom, describeEvent, eventName, when } from '@/components/admin/kit';
import { Pager } from '@/components/ui/pager';
import { Input, PageHeader, Select } from '@/components/ui/primitives';
import { isSessionGone, signInUrlFor } from '@/lib/admin-gate';
import { ApiError, api } from '@/lib/api';

type Row = {
  id: string;
  kind: string;
  userId: string | null;
  actorId: string | null;
  detail: unknown;
  createdAt: string;
  userEmail: string | null;
  actorEmail: string | null;
};
type Page = { rows: Row[]; total: number; kinds: string[] };

const PAGE = 50;
const RANGES = [
  ['', 'All time'],
  ['1', 'Last 24 hours'],
  ['7', 'Last 7 days'],
  ['30', 'Last 30 days'],
] as const;

export default function AdminActivityPage() {
  const router = useRouter();
  const [kind, setKind] = useState('');
  const [days, setDays] = useState('7');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const query = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
    if (kind) query.set('kind', kind);
    if (days) query.set('days', days);
    if (q) query.set('q', q);
    api<Page>(`/admin/activity?${query}`)
      .then(setPage)
      .catch((e: unknown) => {
        if (isSessionGone(e)) router.replace(signInUrlFor('/admin/activity'));
        else setError(e instanceof ApiError ? e.problem.title : 'Could not load the log.');
      });
  }, [router, kind, days, q, offset]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
      <PageHeader
        title="Activity log"
        lede="Every administrator action and every sensitive change on an account. Nothing here can be edited or deleted."
      />

      <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto]">
        <label className="sr-only" htmlFor="activity-search">
          Search by email
        </label>
        <Input
          id="activity-search"
          type="search"
          placeholder="Search by email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          aria-label="Kind"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setOffset(0);
          }}
          data-testid="activity-kind"
        >
          <option value="">Kind: all</option>
          {(page?.kinds ?? []).map((k) => (
            <option key={k} value={k}>
              {eventName(k)}
            </option>
          ))}
        </Select>
        <Select
          aria-label="When"
          value={days}
          onChange={(e) => {
            setDays(e.target.value);
            setOffset(0);
          }}
        >
          {RANGES.map(([value, label]) => (
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

      {page ? (
        page.rows.length === 0 ? (
          <p className="mt-6 text-sm text-muted">Nothing logged for these filters.</p>
        ) : (
          <>
            <div className="relative mt-4 overflow-x-auto rounded-md border border-line bg-surface">
              <table className="w-full min-w-[48rem] text-sm" data-testid="admin-activity">
                <thead className="text-left text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2">When</th>
                    <th className="px-3 py-2">What</th>
                    <th className="px-3 py-2">Account</th>
                    <th className="px-3 py-2">By</th>
                  </tr>
                </thead>
                <tbody>
                  {page.rows.map((r) => (
                    <tr key={r.id} className="border-t border-line align-top">
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">
                        {when(r.createdAt)}
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-semibold">{eventName(r.kind)}</span>{' '}
                        <span className="text-muted">{describeEvent(r.kind, r.detail)}</span>
                      </td>
                      <td className="px-3 py-2">
                        {r.userId && r.userEmail ? (
                          <Link href={`/admin/users/${r.userId}`} className="hover:underline">
                            {r.userEmail}
                          </Link>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted">{byWhom(r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager
              offset={offset}
              limit={PAGE}
              total={page.total}
              onChange={setOffset}
              noun="events"
            />
          </>
        )
      ) : !error ? (
        <p className="mt-6 text-sm text-muted">Loading…</p>
      ) : null}
    </main>
  );
}
