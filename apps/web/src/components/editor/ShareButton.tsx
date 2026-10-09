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
 * A share is bound to an email address, not a secret link: the person signs in with that address.
 * That is worth saying in the UI, because "share link" everywhere else on the web means "anyone
 * with this URL", and a thesis is not that.
 *
 * ADR-0057 made it a roles screen: everyone who has access is listed with what they may do —
 * Guide (comments and suggested revisions), Co-author (edits live) or Reader (reads) — and the
 * owner can change that or take it away.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { useStayInWindow } from '@/lib/stay-in-window';

type Role = 'GUIDE' | 'COAUTHOR' | 'READER';

/** ADR-0057: "anyone with the link can read". `url` is present only on the answer that made it. */
type LinkStatus = {
  enabled: boolean;
  createdAt: string | null;
  views: number;
  lastViewedAt: string | null;
  url?: string;
};

type Share = {
  id: string;
  guideEmail: string;
  createdAt: string;
  acceptedAt: string | null;
  comments: number;
  url: string;
  canEdit: boolean;
  role: Role;
};

const ROLE_LABEL: Record<Role, string> = {
  GUIDE: 'Guide / committee',
  COAUTHOR: 'Co-author',
  READER: 'Reader',
};

const ROLE_HELP: Record<Role, string> = {
  GUIDE: 'can comment and suggest',
  COAUTHOR: 'can edit with you, live',
  READER: 'can read',
};

function problemText(e: unknown, fallback: string): string {
  return e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : fallback;
}

export function ShareButton({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Measured once open: on a phone the header wraps and "Share" may sit far from the right edge.
  const panel = useStayInWindow<HTMLDivElement>(open);
  const [shares, setShares] = useState<Share[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('GUIDE');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** ADR-0028: Co-author is offered only when live editing is on. */
  const [liveAvailable, setLiveAvailable] = useState(false);
  const [link, setLink] = useState<LinkStatus | null>(null);
  /** The URL, held only in this panel's memory: the server keeps a hash, never the link. */
  const [linkUrl, setLinkUrl] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Share[]>(`/documents/${documentId}/feedback/shares`)
      .then(setShares)
      .catch(() => undefined);
    api<Record<string, boolean>>('/flags')
      .then((flags) => setLiveAvailable(flags.collaboration === true))
      .catch(() => undefined);
    api<LinkStatus>(`/documents/${documentId}/feedback/link`)
      .then(setLink)
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
        { method: 'POST', body: JSON.stringify({ guideEmail, role }) },
      );
      setEmail('');
      setNotice(
        made.mailed === false
          ? `The invitation could not be emailed just now. Send ${guideEmail} this link yourself: ${made.url}`
          : role === 'COAUTHOR'
            ? `${guideEmail} can now write this thesis with you, live, by signing in with that address.`
            : role === 'READER'
              ? `${guideEmail} can now read this thesis by signing in with that address.`
              : `${guideEmail} can now open this thesis read-only and comment by signing in with that address.`,
      );
      load();
    } catch (e) {
      setError(problemText(e, 'Could not share.'));
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(id: string, next: Role) {
    setBusy(true);
    setError(null);
    try {
      const updated = await api<Share>(`/documents/${documentId}/feedback/shares/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ role: next }),
      });
      setNotice(`${updated.guideEmail} is now a ${ROLE_LABEL[next].toLowerCase()}.`);
      load();
    } catch (e) {
      setError(problemText(e, 'Could not change that.'));
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
      setError(problemText(e, 'Could not revoke.'));
    } finally {
      setBusy(false);
    }
  }

  async function turnLinkOn() {
    setBusy(true);
    setError(null);
    try {
      const made = await api<LinkStatus>(`/documents/${documentId}/feedback/link`, {
        method: 'POST',
        body: '{}',
      });
      setLink(made);
      setLinkUrl(made.url ?? null);
      setNotice(
        link?.enabled
          ? 'A new link is ready. The old one no longer works.'
          : 'Anyone with this link can now read the thesis. Copy it now — it is shown only once.',
      );
    } catch (e) {
      setError(problemText(e, 'Could not make a link.'));
    } finally {
      setBusy(false);
    }
  }

  async function turnLinkOff() {
    setBusy(true);
    setError(null);
    try {
      setLink(
        await api<LinkStatus>(`/documents/${documentId}/feedback/link`, { method: 'DELETE' }),
      );
      setLinkUrl(null);
      setNotice('The link is off. Anyone who had it can no longer open the thesis.');
    } catch (e) {
      setError(problemText(e, 'Could not turn the link off.'));
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!linkUrl) return;
    try {
      await navigator.clipboard.writeText(linkUrl);
      setNotice('Link copied.');
    } catch {
      setNotice('Select the link and copy it.');
    }
  }

  /** ADR-0057: a separate thesis of your own — none of the people here come with it. */
  async function makeCopy() {
    setBusy(true);
    setError(null);
    try {
      const copy = await api<{ id: string; firstChapterId: string | null }>(
        `/documents/${documentId}/copy`,
        { method: 'POST', body: '{}' },
      );
      setOpen(false);
      router.push(`/app/d/${copy.id}/write/${copy.firstChapterId ?? 'none'}`);
    } catch (e) {
      setError(problemText(e, 'Could not make a copy.'));
      setBusy(false);
    }
  }

  const offered: Role[] = liveAvailable ? ['GUIDE', 'COAUTHOR', 'READER'] : ['GUIDE', 'READER'];

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
          ref={panel.ref}
          style={panel.style}
          className="absolute right-0 top-full z-40 mt-1 w-[min(26rem,calc(100vw-2rem))] rounded-md border border-line bg-surface p-3 text-left shadow-lg"
        >
          <p className="text-xs text-muted">
            People you share with see what you have written — never your sources, your AI or your
            usage. Only you can change the thesis unless you make someone a co-author.
          </p>

          <div className="mt-2 flex gap-2">
            <input
              type="email"
              value={email}
              disabled={busy}
              placeholder="supervisor@university.edu"
              aria-label="Their email address"
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
            <select
              value={role}
              disabled={busy}
              aria-label="What they may do"
              onChange={(e) => setRole(e.target.value as Role)}
              data-testid="share-role"
              className="h-8 shrink-0 rounded-md border border-line bg-paper px-1 text-xs text-ink"
            >
              {offered.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
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
            {ROLE_LABEL[role]}: {ROLE_HELP[role]}. They sign in with this address.
          </p>

          {error ? (
            <p role="alert" className="mt-2 text-xs text-warn">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p role="status" className="mt-2 break-words text-xs text-ok">
              {notice}
            </p>
          ) : null}

          <section className="mt-3 border-t border-line pt-2" aria-label="Who has access">
            <h3 className="text-xs font-semibold text-ink">Who has access</h3>
            <ul className="mt-1 grid list-none gap-1.5 p-0" data-testid="share-list">
              <li className="flex items-baseline justify-between gap-2 text-xs">
                <span className="text-ink">You</span>
                <span className="text-muted">Owner</span>
              </li>
              {shares.map((s) => (
                <li
                  key={s.id}
                  data-testid="share-row"
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-ink">{s.guideEmail}</span>
                    <span className="text-muted">
                      {ROLE_HELP[s.role]} · {s.acceptedAt ? 'opened it' : 'not opened yet'}
                      {s.comments > 0 ? ` · ${s.comments} comments` : ''}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <select
                      value={s.role}
                      disabled={busy}
                      aria-label={`What ${s.guideEmail} may do`}
                      onChange={(e) => void changeRole(s.id, e.target.value as Role)}
                      data-testid="share-row-role"
                      className="h-7 rounded-md border border-line bg-paper px-1 text-xs text-ink"
                    >
                      {(offered.includes(s.role) ? offered : [...offered, s.role]).map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void revoke(s.id)}
                      className="text-danger underline disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section
            className="mt-3 border-t border-line pt-2"
            aria-label="Anyone with the link"
            data-testid="share-link"
          >
            <h3 className="text-xs font-semibold text-ink">Anyone with the link</h3>
            {link?.enabled ? (
              <>
                <p className="mt-1 text-xs text-muted">
                  On — anyone who has the link can read the text. No comments, no AI, no sources, no
                  email.{' '}
                  {link.views > 0
                    ? `Opened ${link.views} ${link.views === 1 ? 'time' : 'times'}.`
                    : 'Not opened yet.'}
                </p>
                {linkUrl ? (
                  <div className="mt-1 flex gap-2">
                    <input
                      readOnly
                      value={linkUrl}
                      aria-label="The read-only link"
                      onFocus={(e) => e.currentTarget.select()}
                      data-testid="share-link-url"
                      className="h-7 min-w-0 flex-1 rounded-md border border-line bg-paper px-2 text-xs text-ink"
                    />
                    <button
                      type="button"
                      onClick={() => void copyLink()}
                      className="shrink-0 rounded-md border border-line-strong bg-surface px-2 text-xs text-ink hover:bg-sunk"
                    >
                      Copy
                    </button>
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-faint">
                    For safety the link is shown only when it is made. Lost it? Make a new one — the
                    old one stops working.
                  </p>
                )}
                <div className="mt-1 flex gap-3 text-xs">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void turnLinkOn()}
                    data-testid="share-link-new"
                    className="text-ink underline disabled:opacity-50"
                  >
                    Make a new link
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void turnLinkOff()}
                    data-testid="share-link-off"
                    className="text-danger underline disabled:opacity-50"
                  >
                    Turn off
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="mt-1 text-xs text-muted">
                  Off. Turn it on to let anyone who has the link read the thesis — read only, never
                  edit.
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void turnLinkOn()}
                  data-testid="share-link-on"
                  className="mt-1 rounded-md border border-line-strong bg-surface px-2.5 py-1 text-xs font-semibold text-ink hover:bg-sunk disabled:opacity-50"
                >
                  Turn on a read-only link
                </button>
              </>
            )}
          </section>

          <section className="mt-3 border-t border-line pt-2" aria-label="Make a copy">
            <h3 className="text-xs font-semibold text-ink">Make a copy</h3>
            <p className="mt-1 text-xs text-muted">
              A separate thesis of your own with the chapters, outline and library. Nobody above
              comes with it, and it uses none of your AI allowance.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void makeCopy()}
              data-testid="share-make-copy"
              className="mt-1 rounded-md border border-line-strong bg-surface px-2.5 py-1 text-xs font-semibold text-ink hover:bg-sunk disabled:opacity-50"
            >
              Make a copy
            </button>
          </section>

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
