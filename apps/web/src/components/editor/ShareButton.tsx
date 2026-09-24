'use client';

/**
 * Share with a supervisor, from where the writing happens (2026-09-21).
 *
 * The share itself is not new — `/app/d/:id/review` has created guide shares since the committee
 * cycle was built. What was new is the observation that nobody finds it there: a student finishes
 * a chapter *in the editor* and wants to send it *then*, and asking them to navigate to a screen
 * named "Review" to do it is asking them to already know the feature exists.
 *
 * So this is a surface, not a feature. It posts to the same endpoint, lists the same shares, and
 * revokes through the same route. The review screen remains the place to read what came back.
 *
 * A share is bound to an email address, not a secret link: the guide signs in with that address.
 * That is worth saying in the UI, because "share link" everywhere else on the web means "anyone
 * with this URL", and a thesis is not that.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';

type Share = {
  id: string;
  guideEmail: string;
  createdAt: string;
  acceptedAt: string | null;
  comments: number;
  url: string;
  canEdit: boolean;
};

export function ShareButton({ documentId }: { documentId: string }) {
  const [open, setOpen] = useState(false);
  const [shares, setShares] = useState<Share[]>([]);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** ADR-0028: invite a co-author rather than a commenting guide. Offered only when live editing is on. */
  const [canEdit, setCanEdit] = useState(false);
  const [liveAvailable, setLiveAvailable] = useState(false);

  const load = useCallback(() => {
    api<Share[]>(`/documents/${documentId}/feedback/shares`)
      .then(setShares)
      .catch(() => undefined);
    api<Record<string, boolean>>('/flags')
      .then((flags) => setLiveAvailable(flags.collaboration === true))
      .catch(() => undefined);
  }, [documentId]);

  // Only when the panel is opened: a student who never shares should not pay for a request on
  // every chapter they open.
  useEffect(() => {
    if (open) load();
  }, [open, load]);

  async function share() {
    const guideEmail = email.trim();
    if (!guideEmail) return;
    setBusy(true);
    setError(null);
    try {
      const made = await api<Share & { mailed?: boolean }>(
        `/documents/${documentId}/feedback/shares`,
        { method: 'POST', body: JSON.stringify({ guideEmail, canEdit }) },
      );
      setEmail('');
      setNotice(
        made.mailed === false
          ? `The invitation could not be emailed just now. Send ${guideEmail} this link yourself: ${made.url}`
          : canEdit
            ? `${guideEmail} can now write this thesis with you, live, by signing in with that address.`
            : `${guideEmail} can now open this thesis read-only by signing in with that address.`,
      );
      load();
    } catch (e) {
      setError(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not share.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    setError(null);
    try {
      await api(`/documents/${documentId}/feedback/shares/${id}`, { method: 'DELETE' });
      setNotice('Access removed. Their comments are kept.');
      load();
    } catch (e) {
      setError(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not revoke.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="relative">
      <button
        type="button"
        data-testid="share-button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="rounded-md border border-line-strong bg-surface px-2.5 py-1 text-[12px] font-semibold text-ink transition-colors hover:bg-sunk"
      >
        Share
        {shares.length > 0 ? <span className="ml-1 text-muted">· {shares.length}</span> : null}
      </button>

      {open ? (
        <div
          data-testid="share-panel"
          className="absolute right-0 top-full z-40 mt-1 w-[24rem] rounded-md border border-line bg-surface p-3 text-left shadow-lg"
        >
          <p className="text-xs text-muted">
            Your guide reads the thesis and leaves comments. They cannot edit it, and they only see
            what you have written — not your sources or your usage.
          </p>

          <div className="mt-2 flex gap-2">
            <input
              type="email"
              value={email}
              disabled={busy}
              placeholder="supervisor@university.edu"
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void share();
                }
              }}
              data-testid="share-email"
              className="h-8 min-w-0 flex-1 rounded-md border border-line bg-paper px-2 text-sm text-ink"
            />
            <button
              type="button"
              disabled={busy || email.trim() === ''}
              onClick={() => void share()}
              data-testid="share-send"
              className="shrink-0 rounded-md bg-accent px-3 py-1 text-xs font-semibold text-accent-ink transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {busy ? 'Sending…' : 'Send'}
            </button>
          </div>
          <p className="mt-1 text-xs text-faint">
            They sign in with this address. There is no secret link to forward.
          </p>
          {liveAvailable ? (
            <label className="mt-2 flex items-start gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={canEdit}
                onChange={(e) => setCanEdit(e.target.checked)}
                data-testid="share-can-edit"
                className="mt-0.5"
              />
              <span>
                Let them <span className="text-ink">edit with me, live</span>. They can type in a
                chapter alongside you; AI, uploads and exports stay yours.
              </span>
            </label>
          ) : null}

          {error ? (
            <p role="alert" className="mt-2 text-xs text-warn">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p role="status" className="mt-2 text-xs text-ok">
              {notice}
            </p>
          ) : null}

          {shares.length > 0 ? (
            <ul className="mt-3 grid list-none gap-1 border-t border-line p-0 pt-2">
              {shares.map((s) => (
                <li key={s.id} className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="min-w-0">
                    <span className="block truncate text-ink">{s.guideEmail}</span>
                    <span className="text-muted">
                      {s.canEdit ? 'Co-author · ' : ''}
                      {s.acceptedAt ? 'Opened it' : 'Not opened yet'}
                      {s.comments > 0 ? ` · ${s.comments} comments` : ''}
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void revoke(s.id)}
                    className="shrink-0 text-danger underline disabled:opacity-50"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <p className="mt-3 border-t border-line pt-2 text-xs text-muted">
            <Link href={`/app/d/${documentId}/review`} className="underline">
              Read their comments
            </Link>{' '}
            on the review screen.
          </p>
        </div>
      ) : null}
    </span>
  );
}
