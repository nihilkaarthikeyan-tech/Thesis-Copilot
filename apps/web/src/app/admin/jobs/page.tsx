'use client';

/**
 * `/admin/jobs` — the work that runs behind the scenes (2026-09-29): reading papers, searches,
 * drafts. One row per queue, then the jobs that ran out of retries, newest first, each with a
 * Retry. A job's payload is never shown — it can carry a student's text — only why it failed
 * and whose it was.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ago, problemText, whole } from '@/components/admin/kit';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/primitives';
import { isSessionGone, signInUrlFor } from '@/lib/admin-gate';
import { api } from '@/lib/api';

type Queue = {
  queue: string;
  waiting: number;
  active: number;
  delayed: number;
  completed: number;
  failed: number;
  reachable: boolean;
};
type Failure = {
  id: string;
  queue: string;
  reason: string;
  attempts: number;
  failedAt: number | null;
  userId: string | null;
  userEmail: string | null;
};

const QUEUE_NAMES: Record<string, string> = {
  'extract-paper': 'Reading a paper',
  'index-source': 'Making a paper searchable',
  'resolve-reference': 'Finding a reference',
  'search-literature': 'Literature search',
  'draft-section': 'Drafting a section',
  'generate-outline': 'Building an outline',
  coherence: 'Consistency check',
};
const queueName = (q: string) => QUEUE_NAMES[q] ?? q;

export default function AdminJobsPage() {
  const router = useRouter();
  const [data, setData] = useState<{ queues: Queue[]; failed: Failure[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ queues: Queue[]; failed: Failure[] }>('/admin/jobs')
      .then(setData)
      .catch((e: unknown) => {
        if (isSessionGone(e)) router.replace(signInUrlFor('/admin/jobs'));
        else setError(problemText(e, 'Could not load the jobs.'));
      });
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  async function retry(key: string, path: string) {
    setBusy(key);
    setNotice(null);
    setError(null);
    try {
      const r = await api<{ retried: number }>(path, { method: 'POST', body: '{}' });
      setNotice(
        r.retried === 0
          ? 'Nothing to retry.'
          : `${r.retried} job${r.retried === 1 ? '' : 's'} put back to run again.`,
      );
      load();
    } catch (e) {
      setError(problemText(e, 'The retry did not go through.'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
      <PageHeader
        title="Background jobs"
        lede="The work that runs behind the scenes: reading papers, searches, drafts, outlines."
      />
      {error ? (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mt-4 text-sm text-ok" data-testid="jobs-notice">
          {notice}
        </p>
      ) : null}
      {!data && !error ? <p className="mt-6 text-sm text-muted">Loading…</p> : null}

      {data ? (
        <>
          <div className="relative mt-5 overflow-x-auto rounded-md border border-line bg-surface">
            <table className="w-full min-w-[40rem] text-sm" data-testid="admin-queues">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="px-3 py-2">Kind</th>
                  <th className="px-3 py-2">Waiting</th>
                  <th className="px-3 py-2">Running</th>
                  <th className="px-3 py-2">Done (kept)</th>
                  <th className="px-3 py-2">Failed</th>
                </tr>
              </thead>
              <tbody>
                {data.queues.map((q) => (
                  <tr key={q.queue} className="border-t border-line">
                    <td className="px-3 py-2">
                      <span className="font-semibold">{queueName(q.queue)}</span>{' '}
                      <span className="font-mono text-[11px] text-faint">{q.queue}</span>
                      {!q.reachable ? (
                        <span className="ml-2 text-xs text-danger">could not be read</span>
                      ) : null}
                    </td>
                    <td className="tnum px-3 py-2">{whole(q.waiting + q.delayed)}</td>
                    <td className="tnum px-3 py-2">{whole(q.active)}</td>
                    <td className="tnum px-3 py-2">{whole(q.completed)}</td>
                    <td className={`tnum px-3 py-2 ${q.failed ? 'font-bold text-danger' : ''}`}>
                      {whole(q.failed)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-8 flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-[17px] font-bold text-ink">Failed, most recent first</h2>
            {data.failed.length > 0 ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={busy !== null}
                onClick={() => void retry('all', '/admin/jobs/retry-all')}
                data-testid="jobs-retry-all"
              >
                {busy === 'all' ? 'Retrying…' : 'Retry all failed'}
              </Button>
            ) : null}
          </div>
          {data.failed.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No failed jobs. Everything has run.</p>
          ) : (
            <div className="relative mt-3 overflow-x-auto rounded-md border border-line bg-surface">
              <table className="w-full min-w-[44rem] text-sm" data-testid="admin-failed-jobs">
                <thead className="text-left text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2">When</th>
                    <th className="px-3 py-2">Job</th>
                    <th className="px-3 py-2">Why it failed</th>
                    <th className="px-3 py-2">For</th>
                    <th className="px-3 py-2">
                      <span className="sr-only">Retry</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.failed.map((f) => (
                    <tr key={`${f.queue}:${f.id}`} className="border-t border-line align-top">
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">
                        {f.failedAt ? ago(new Date(f.failedAt).toISOString()) : '—'}
                      </td>
                      <td className="px-3 py-2">{queueName(f.queue)}</td>
                      <td className="max-w-[28rem] px-3 py-2 text-xs">
                        <span className="line-clamp-2" title={f.reason}>
                          {f.reason || 'No reason recorded'}
                        </span>
                        <span className="text-muted">
                          {' '}
                          · after {f.attempts} tr{f.attempts === 1 ? 'y' : 'ies'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {f.userId && f.userEmail ? (
                          <Link href={`/admin/users/${f.userId}`} className="hover:underline">
                            {f.userEmail}
                          </Link>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busy !== null}
                          onClick={() =>
                            void retry(
                              `${f.queue}:${f.id}`,
                              `/admin/jobs/${f.queue}/${encodeURIComponent(f.id)}/retry`,
                            )
                          }
                        >
                          Retry
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </main>
  );
}
