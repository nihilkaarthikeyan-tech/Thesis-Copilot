'use client';

/**
 * `/admin` — the overview (2026-09-29, the owner's approved design): how the site is doing,
 * today and this month, on one screen. Every figure is read from the database or the job queue
 * when the page opens; the storage total is at most ten minutes old.
 *
 * The design's "Trials ending" panel is replaced by the newest sign-ups: nothing ends a free
 * trial today (`effectivePlan` keeps FREE_TRIAL for as long as there is no subscription), so a
 * list of trials "ending" would be a list of dates that mean nothing. See docs/PENDING.md.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ago, bytes, inr, whole } from '@/components/admin/kit';
import { Card, PageHeader } from '@/components/ui/primitives';
import { isSessionGone, signInUrlFor } from '@/lib/admin-gate';
import { ApiError, api } from '@/lib/api';

type Overview = {
  students: number;
  newThisWeek: number;
  activeLast7Days: number;
  suspended: number;
  deleting: number;
  paying: number;
  annualSubscriptions: number;
  monthlyRecurringInr: number;
  signupsPerDay: Array<{ day: string; signups: number; withThesis: number }>;
  newest: Array<{ id: string; email: string; createdAt: string; theses: number }>;
  ai: {
    costInr: number;
    budgetInr: number | null;
    averagePerActiveStudentInr: number;
    highestStudentInr: number;
    studentCeilingInr: number;
  };
  jobs: { failed: number; waiting: number; running: number };
  feedback: { unread: number; lastAt: string | null };
  holdings: {
    theses: number;
    chapters: number;
    words: number;
    papers: number;
    uploadedFiles: number;
    storageBytes: number | null;
    storageFiles: number | null;
    databaseBytes: number;
  };
};

function Tile({
  label,
  value,
  note,
  tone,
  href,
  testId,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: 'warn' | 'danger';
  href?: string;
  testId?: string;
}) {
  const body = (
    <>
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p
        className={`tnum mt-1 text-[26px] font-bold leading-tight tracking-[-0.02em] ${
          tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : 'text-ink'
        }`}
      >
        {value}
      </p>
      {note ? <p className="mt-1 text-xs text-muted">{note}</p> : null}
    </>
  );
  return (
    <Card className="p-4" data-testid={testId}>
      {href ? (
        <Link href={href} className="block hover:opacity-80">
          {body}
        </Link>
      ) : (
        body
      )}
    </Card>
  );
}

function SignupChart({ days }: { days: Overview['signupsPerDay'] }) {
  const max = Math.max(1, ...days.map((d) => d.signups));
  const today = days[days.length - 1];
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-bold text-ink">Sign-ups per day</p>
        <p className="text-xs text-muted">
          Last 30 days · the darker part started a thesis · today: {today?.signups ?? 0}
        </p>
      </div>
      <div
        className="mt-4 flex h-32 items-end gap-[3px]"
        role="img"
        aria-label={`Sign-ups over the last 30 days: ${days.reduce((n, d) => n + d.signups, 0)} in total.`}
      >
        {days.map((d) => (
          <div
            key={d.day}
            className="flex h-full flex-1 flex-col justify-end"
            title={`${d.day}: ${d.signups} sign-up${d.signups === 1 ? '' : 's'}, ${d.withThesis} started a thesis`}
          >
            <div
              className="w-full rounded-t-[2px] bg-accent-soft"
              style={{ height: `${((d.signups - d.withThesis) / max) * 100}%` }}
            />
            <div
              className="w-full bg-accent"
              style={{ height: `${(d.withThesis / max) * 100}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-faint">
        <span>{days[0]?.day.slice(5)}</span>
        <span>Today</span>
      </div>
    </Card>
  );
}

export default function AdminOverviewPage() {
  const router = useRouter();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Overview>('/admin/overview')
      .then(setData)
      .catch((e: unknown) => {
        if (isSessionGone(e)) router.replace(signInUrlFor('/admin'));
        else setError(e instanceof ApiError ? e.problem.title : 'Could not load the overview.');
      });
  }, [router]);

  const budgetShare =
    data?.ai.budgetInr && data.ai.budgetInr > 0
      ? Math.round((data.ai.costInr / data.ai.budgetInr) * 100)
      : null;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
      <PageHeader title="Overview" lede="How the site is doing, today and this month." />

      {error ? (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {!data && !error ? <p className="mt-6 text-sm text-muted">Loading…</p> : null}

      {data ? (
        <div className="mt-6 space-y-4" data-testid="admin-overview">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile
              label="Students"
              value={whole(data.students)}
              note={`+${whole(data.newThisWeek)} this week`}
              href="/admin/users"
              testId="overview-students"
            />
            <Tile
              label="Active in the last 7 days"
              value={whole(data.activeLast7Days)}
              note={
                data.students
                  ? `${Math.round((data.activeLast7Days / data.students) * 100)}% of all students`
                  : undefined
              }
            />
            <Tile
              label="Paying students"
              value={whole(data.paying)}
              note={
                data.students
                  ? `${((data.paying / data.students) * 100).toFixed(1)}% of all students`
                  : undefined
              }
            />
            <Tile
              label="Recurring revenue"
              value={`₹${whole(data.monthlyRecurringInr)}`}
              note={`a month${data.annualSubscriptions ? ` · ${data.annualSubscriptions} annual` : ''}`}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[2fr_1fr]">
            <SignupChart days={data.signupsPerDay} />
            <Card className="p-4">
              <p className="text-sm font-bold text-ink">Newest sign-ups</p>
              <ul className="mt-3 space-y-2 text-sm">
                {data.newest.map((u) => (
                  <li key={u.id} className="flex items-baseline justify-between gap-3">
                    <Link
                      href={`/admin/users/${u.id}`}
                      className="min-w-0 truncate font-medium hover:underline"
                    >
                      {u.email}
                    </Link>
                    <span className="shrink-0 text-xs text-muted">{ago(u.createdAt)}</span>
                  </li>
                ))}
              </ul>
              {data.suspended || data.deleting ? (
                <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
                  {data.suspended} suspended · {data.deleting} waiting to be deleted
                </p>
              ) : null}
            </Card>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile
              label="AI cost this month"
              value={inr(data.ai.costInr)}
              note={
                budgetShare !== null
                  ? `${budgetShare}% of the ${inr(data.ai.budgetInr ?? 0)} site budget`
                  : 'No site budget set'
              }
              tone={budgetShare !== null && budgetShare >= 80 ? 'warn' : undefined}
              href="/admin/settings#costs"
            />
            <Tile
              label="Average cost per active student"
              value={inr(data.ai.averagePerActiveStudentInr)}
              note={`Limit ${inr(data.ai.studentCeilingInr)} · highest ${inr(data.ai.highestStudentInr)}`}
            />
            <Tile
              label="Background jobs"
              value={data.jobs.failed ? `${data.jobs.failed} failed` : 'All fine'}
              note={`${data.jobs.running} running · ${data.jobs.waiting} waiting`}
              tone={data.jobs.failed ? 'danger' : undefined}
              href="/admin/jobs"
              testId="overview-jobs"
            />
            <Tile
              label="Feedback"
              value={data.feedback.unread ? `${data.feedback.unread} unread` : 'All read'}
              note={data.feedback.lastAt ? `Last: ${ago(data.feedback.lastAt)}` : 'None yet'}
              tone={data.feedback.unread ? 'warn' : undefined}
              href="/admin/feedback"
            />
          </div>

          <Card className="p-4">
            <p className="text-sm font-bold text-ink">What the site holds</p>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
              {[
                ['Theses', whole(data.holdings.theses)],
                ['Chapters', whole(data.holdings.chapters)],
                ['Words written', whole(data.holdings.words)],
                ['Papers in libraries', whole(data.holdings.papers)],
                ['Uploaded files', whole(data.holdings.uploadedFiles)],
                [
                  'Storage used',
                  `${bytes(data.holdings.storageBytes)} files · ${bytes(data.holdings.databaseBytes)} database`,
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-muted">{label}</dt>
                  <dd className="tnum mt-0.5 font-bold text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      ) : null}
    </main>
  );
}
