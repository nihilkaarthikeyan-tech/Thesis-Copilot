'use client';

/**
 * `/admin/feedback` — what students send from the Feedback button in the editor (2026-09-29).
 *
 * Until this existed feedback went only to one inbox by email. It is kept in the activity log
 * too, so it is listed here with its state: unread, read, answered. "Reply by email" opens the
 * admin's own mail program addressed to the student; nothing is sent from here.
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

export default function AdminFeedbackPage() {
  const router = useRouter();
  const [status, setStatus] = useState<'unread' | 'all'>('unread');
  const [items, setItems] = useState<Item[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Messages the admin marked unread on purpose; opening them again must not undo that. */
  const keptUnread = useRef(new Set<string>());

  const load = useCallback(() => {
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
        lede="What students send from the Feedback button in the editor."
        actions={
          <Select
            aria-label="Show"
            value={status}
            onChange={(e) => setStatus(e.target.value as 'unread' | 'all')}
          >
            <option value="unread">Unread</option>
            <option value="all">All</option>
          </Select>
        }
      />
      {error ? (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {!items && !error ? <p className="mt-6 text-sm text-muted">Loading…</p> : null}

      {items ? (
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
