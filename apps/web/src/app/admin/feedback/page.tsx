'use client';

/**
 * `/admin/feedback` — what students send from the Feedback button in the editor (2026-09-29).
 *
 * Until this existed feedback went only to one inbox by email. It is kept in the activity log
 * too, so it is listed here with its state: unread, read, answered. "Reply by email" opens the
 * admin's own mail program addressed to the student; nothing is sent from here.
 *
 * "Ratings" (R36, ADR-0115) lists the thumbs students gave a chapter build or a viva question
 * set, with their one-line notes.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ago, problemText, when } from '@/components/admin/kit';
import { Button } from '@/components/ui/button';
import { Badge, Card, PageHeader, Select } from '@/components/ui/primitives';
import { isSessionGone, signInUrlFor } from '@/lib/admin-gate';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

type Item = {
  id: string;
  createdAt: string;
  message: string;
  page: string | null;
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  documentId: string | null;
  documentTitle: string | null;
  readAt: string | null;
  answeredAt: string | null;
};

/** R36 (ADR-0115): a student's thumbs on a generated run, with their one-line note. */
type RatingRow = {
  id: string;
  updatedAt: string;
  kind: string;
  runId: string;
  rating: 1 | -1;
  note: string | null;
  userId: string;
  userEmail: string | null;
  documentId: string;
  documentTitle: string | null;
};
type Ratings = { rows: RatingRow[]; total: number; useful: number; notUseful: number };

const RATED: Record<string, string> = {
  CHAPTER_BUILD: 'Chapter build',
  VIVA: 'Viva questions',
};

export default function AdminFeedbackPage() {
  const router = useRouter();
  const [status, setStatus] = useState<'unread' | 'all' | 'ratings'>('unread');
  const [ratings, setRatings] = useState<Ratings | null>(null);
  const [items, setItems] = useState<Item[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Messages the admin marked unread on purpose; opening them again must not undo that. */
  const keptUnread = useRef(new Set<string>());

  const load = useCallback(() => {
    if (status === 'ratings') {
      api<Ratings>('/admin/feedback/ratings?limit=100')
        .then(setRatings)
        .catch((e: unknown) => {
          if (isSessionGone(e)) router.replace(signInUrlFor('/admin/feedback'));
          else setError(problemText(e, 'Could not load the ratings.'));
        });
      return;
    }
    api<{ rows: Item[] }>(`/admin/feedback?status=${status}&limit=100`)
      .then((page) => {
        setItems(page.rows);
        setSelected((current) =>
          current && page.rows.some((r) => r.id === current) ? current : (page.rows[0]?.id ?? null),
        );
      })
      .catch((e: unknown) => {
        if (isSessionGone(e)) router.replace(signInUrlFor('/admin/feedback'));
        else setError(problemText(e, 'Could not load the feedback.'));
      });
  }, [router, status]);

  useEffect(() => {
    load();
  }, [load]);

  const item = items?.find((i) => i.id === selected) ?? null;

  // Opening a message marks it read, as a mail program does.
  useEffect(() => {
    if (!item || item.readAt || keptUnread.current.has(item.id)) return;
    api(`/admin/feedback/${item.id}/read`, { method: 'POST', body: '{}' })
      .then(() =>
        setItems(
          (list) =>
            list?.map((i) => (i.id === item.id ? { ...i, readAt: new Date().toISOString() } : i)) ??
            null,
        ),
      )
      .catch(() => undefined);
  }, [item]);

  async function mark(id: string, how: 'answered' | 'unread') {
    setBusy(true);
    if (how === 'unread') keptUnread.current.add(id);
    else keptUnread.current.delete(id);
    try {
      await api(`/admin/feedback/${id}/${how}`, { method: 'POST', body: '{}' });
      load();
    } catch (e) {
      setError(problemText(e, 'Could not save that.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
      <PageHeader
        title="Feedback"
        lede="What students send from the Feedback button in the editor, and how they rated what was built for them."
        actions={
          <Select
            aria-label="Show"
            value={status}
            onChange={(e) => setStatus(e.target.value as 'unread' | 'all' | 'ratings')}
            data-testid="feedback-show"
          >
            <option value="unread">Unread</option>
            <option value="all">All</option>
            <option value="ratings">Ratings</option>
          </Select>
        }
      />
      {error ? (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {status === 'ratings' ? (
        <RatingsList ratings={ratings} />
      ) : !items && !error ? (
        <p className="mt-6 text-sm text-muted">Loading…</p>
      ) : null}

      {items && status !== 'ratings' ? (
        items.length === 0 ? (
          <p className="mt-6 text-sm text-muted">
            {status === 'unread' ? 'Nothing unread. ' : 'No feedback yet. '}
            {status === 'unread' ? (
              <button type="button" className="underline" onClick={() => setStatus('all')}>
                Show all
              </button>
            ) : null}
          </p>
        ) : (
          <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[20rem_1fr]">
            <ul
              className="divide-y divide-line rounded-md border border-line bg-surface"
              data-testid="feedback-list"
            >
              {items.map((i) => (
                <li key={i.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(i.id)}
                    aria-current={i.id === selected ? 'true' : undefined}
                    className={cn(
                      'block w-full px-3 py-2.5 text-left text-sm',
                      i.id === selected ? 'bg-accent-soft' : 'hover:bg-sunk',
                    )}
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span
                        className={cn('truncate', i.readAt ? 'text-muted' : 'font-bold text-ink')}
                      >
                        {i.userEmail ?? 'unknown'}
                      </span>
                      <span className="shrink-0 text-xs text-muted">{ago(i.createdAt)}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted">{i.message}</span>
                  </button>
                </li>
              ))}
            </ul>

            {item ? (
              <Card className="p-5" data-testid="feedback-message">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-bold text-ink">{item.userEmail ?? 'unknown'}</p>
                  {item.answeredAt ? <Badge tone="ok">Answered</Badge> : null}
                </div>
                <p className="mt-1 text-xs text-muted">
                  {when(item.createdAt)}
                  {item.documentTitle ? ` · “${item.documentTitle}”` : ''}
                  {item.page ? ` · ${item.page}` : ''}
                </p>
                <p className="mt-4 whitespace-pre-wrap text-[15px] leading-relaxed">
                  {item.message}
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {item.userEmail ? (
                    <Button asChild size="sm">
                      <a
                        href={`mailto:${item.userEmail}?subject=${encodeURIComponent('Re: your Thesis Copilot feedback')}`}
                      >
                        Reply by email
                      </a>
                    </Button>
                  ) : null}
                  {item.answeredAt ? null : (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() => void mark(item.id, 'answered')}
                      data-testid="feedback-answered"
                    >
                      Mark answered
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => void mark(item.id, 'unread')}
                  >
                    Mark unread
                  </Button>
                  {item.userId ? (
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/admin/users/${item.userId}`}>Open their account</Link>
                    </Button>
                  ) : null}
                </div>
              </Card>
            ) : null}
          </div>
        )
      ) : null}
    </main>
  );
}

/**
 * R36 (ADR-0115): every "How was this?" a student answered, newest first. Read-only, with no
 * read or answered state: a rating asks for nothing back the way a feedback message does.
 */
function RatingsList({ ratings }: { ratings: Ratings | null }) {
  if (!ratings) return <p className="mt-6 text-sm text-muted">Loading…</p>;
  if (ratings.rows.length === 0) {
    return <p className="mt-6 text-sm text-muted">No ratings yet.</p>;
  }
  return (
    <section className="mt-5" data-testid="ratings">
      <p className="text-sm text-muted">
        {ratings.useful} useful · {ratings.notUseful} not useful
        {ratings.total > ratings.rows.length ? ` · the latest ${ratings.rows.length} shown` : ''}
      </p>
      <ul
        className="mt-3 grid list-none grid-cols-1 divide-y divide-line rounded-md border border-line bg-surface p-0"
        data-testid="ratings-list"
      >
        {ratings.rows.map((r) => (
          <li key={r.id} className="min-w-0 px-3 py-2.5 text-sm">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Badge tone={r.rating === 1 ? 'ok' : 'danger'}>
                {r.rating === 1 ? 'Useful' : 'Not useful'}
              </Badge>
              <span className="font-semibold text-ink">{RATED[r.kind] ?? r.kind}</span>
              <span className="min-w-0 truncate text-muted">{r.userEmail ?? 'unknown'}</span>
              <span className="ml-auto shrink-0 text-xs text-muted">{ago(r.updatedAt)}</span>
            </div>
            {r.documentTitle ? (
              <p className="mt-0.5 text-xs text-muted [overflow-wrap:anywhere]">
                “{r.documentTitle}”
              </p>
            ) : null}
            {r.note ? <p className="mt-1 text-ink [overflow-wrap:anywhere]">{r.note}</p> : null}
            <Link
              href={`/admin/users/${r.userId}`}
              className="mt-1 inline-block text-xs font-semibold text-accent hover:underline"
            >
              Open their account
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
