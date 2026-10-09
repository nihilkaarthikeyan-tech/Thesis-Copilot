'use client';

/**
 * `/admin/users/:id` — one account, and everything an administrator can do to it
 * (PHASES 5.9; rebuilt 2026-09-29 to the owner's approved design).
 *
 * Every action asks first where it cannot be undone, says what it did, and is written to the
 * activity log with the admin's name — the list at the bottom reads that log back. Theses open
 * read-only; opening one emails the student.
 */

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  ago,
  byWhom,
  Dialog,
  day,
  describeEvent,
  eventName,
  inr,
  PLAN_NAMES,
  planName,
  problemText,
  roleName,
  StatusBadge,
  trialOver,
  trialWords,
  when,
  whole,
} from '@/components/admin/kit';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, Input, Label, Textarea } from '@/components/ui/primitives';
import { actionName } from '@/lib/action-names';
import { isSessionGone, signInUrlFor } from '@/lib/admin-gate';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/auth-client';
import type { UserDetail } from '../shared';

/** The roles an admin may hand out — the same list `PUT /admin/users/:id/role` accepts. */
const ASSIGNABLE_ROLES = ['STUDENT', 'INSTITUTION_ADMIN', 'SUPERADMIN'] as const;

const METHOD_NAMES: Record<string, string> = {
  otp: 'an emailed code',
  password: 'a password',
  google: 'Google',
};

type Open =
  | null
  | 'allowance'
  | 'trial'
  | 'suspend'
  | 'delete-account'
  | { kind: 'delete-thesis'; id: string; title: string };

export default function AdminUserPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const session = useSession();
  const myId = (session.data?.user as { id?: string } | undefined)?.id;
  const [user, setUser] = useState<UserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Open>(null);

  const load = useCallback(() => {
    api<UserDetail>(`/admin/users/${id}`)
      .then(setUser)
      .catch((e: unknown) => {
        if (isSessionGone(e)) router.replace(signInUrlFor(`/admin/users/${id}`));
        else setError(e instanceof ApiError ? e.problem.title : 'Could not load the user.');
      });
  }, [id, router]);

  useEffect(() => {
    load();
  }, [load]);

  /** Runs one action: busy while it runs, its sentence on success, the API's words on failure. */
  async function act(run: () => Promise<string>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setNotice(await run());
      setOpen(null);
      load();
    } catch (e) {
      setError(problemText(e, 'That did not work. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  const post = (path: string, body: unknown = {}) =>
    api(path, { method: 'POST', body: JSON.stringify(body) });

  const self = Boolean(user && myId && user.id === myId);
  const firstName = user?.name?.trim().split(/\s+/)[0] || user?.email || '';

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
      <nav className="text-xs text-muted" aria-label="Breadcrumb">
        <Link href="/admin/users" className="hover:underline">
          Users
        </Link>{' '}
        / {user?.email ?? '…'}
      </nav>

      {error ? (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          role="status"
          data-testid="admin-notice"
          className="mt-4 rounded-md border border-ok/30 bg-ok-soft px-3 py-2 text-sm text-ok"
        >
          {notice}
        </p>
      ) : null}

      {!user && !error ? <p className="mt-6 text-sm text-muted">Loading…</p> : null}

      {user ? (
        <>
          <header className="mt-3 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-balance text-[28px] font-bold leading-tight tracking-[-0.02em] text-ink [overflow-wrap:anywhere]">
                {user.name || user.email}
              </h1>
              <p className="mt-1 text-sm text-muted">
                {user.email} · {roleName(user.role)} · joined {day(user.createdAt)} · signs in with{' '}
                {user.signInMethods.map((m) => METHOD_NAMES[m] ?? m).join(', ')} · last active{' '}
                {ago(user.lastActiveAt)}
              </p>
            </div>
            <StatusBadge status={user.status} />
          </header>

          {user.plan === 'FREE_TRIAL' && user.trialEndsAt ? (
            <p
              data-testid="admin-trial"
              className={`mt-4 rounded-md border px-3 py-2 text-sm ${
                trialOver(user.trialEndsAt)
                  ? 'border-warn/30 bg-warn-soft text-warn'
                  : 'border-line bg-surface text-muted'
              }`}
            >
              Free trial {trialWords(user.trialEndsAt)}
              {trialOver(user.trialEndsAt)
                ? ' — the AI features are off until they subscribe, or you extend it.'
                : ` (until ${when(user.trialEndsAt)}).`}
            </p>
          ) : null}
          {user.status === 'suspended' ? (
            <p className="mt-4 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
              Suspended {when(user.suspendedAt)}
              {user.suspendedReason ? ` — “${user.suspendedReason}”` : ''}. They cannot sign in.
            </p>
          ) : null}
          {user.status === 'deleting' && user.deletionRequestedAt ? (
            <p className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-warn">
              Deletion requested {when(user.deletionRequestedAt)}. Everything is erased seven days
              after that.
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await api(`/admin/users/${id}/deletion`, { method: 'DELETE' });
                    return 'Deletion cancelled. The account stays.';
                  })
                }
              >
                Cancel the deletion
              </Button>
            </p>
          ) : null}

          <Card className="mt-6">
            <CardHeader
              title="Actions"
              hint="Every action here is recorded in the activity log with your name."
            />
            <div className="flex flex-wrap items-end gap-2 p-4">
              <Button
                variant="secondary"
                size="sm"
                disabled={busy || self || user.status === 'deleted'}
                data-testid="admin-sign-out-user"
                onClick={() =>
                  void act(async () => {
                    const r = (await post(`/admin/users/${id}/sign-out`)) as { sessions: number };
                    return `Signed out of ${r.sessions} device${r.sessions === 1 ? '' : 's'}.`;
                  })
                }
              >
                Sign out of every device
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy || user.status === 'deleted'}
                data-testid="admin-open-allowance"
                onClick={() => setOpen('allowance')}
              >
                Give extra allowance
              </Button>
              {user.plan === 'FREE_TRIAL' ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy || user.status === 'deleted'}
                  data-testid="admin-open-trial"
                  onClick={() => setOpen('trial')}
                >
                  Extend free trial
                </Button>
              ) : null}
              <label className="flex items-center gap-1.5 text-xs text-muted">
                Plan
                <select
                  disabled={busy}
                  value={user.plan}
                  onChange={(e) => {
                    // Read now: the controlled select snaps back until the reload.
                    const plan = e.target.value;
                    void act(async () => {
                      await api(`/admin/users/${id}/plan`, {
                        method: 'PUT',
                        body: JSON.stringify({ plan }),
                      });
                      return `Plan set to ${planName(plan)}.`;
                    });
                  }}
                  className="h-7 rounded-md border border-line-strong bg-surface px-2 text-[12px] font-semibold text-ink"
                >
                  {Object.entries(PLAN_NAMES).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5 text-xs text-muted">
                Role
                <select
                  data-testid="admin-role"
                  disabled={busy || user.role === 'GUIDE'}
                  value={user.role}
                  onChange={(e) => {
                    const role = e.target.value;
                    void act(async () => {
                      await api(`/admin/users/${id}/role`, {
                        method: 'PUT',
                        body: JSON.stringify({ role }),
                      });
                      return `Role set to ${role}. It applies from their next page load.`;
                    });
                  }}
                  className="h-7 rounded-md border border-line-strong bg-surface px-2 text-[12px] font-semibold text-ink"
                >
                  {(user.role === 'GUIDE' ? ['GUIDE'] : ASSIGNABLE_ROLES).map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
              {user.status === 'suspended' ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  data-testid="admin-unsuspend"
                  onClick={() =>
                    void act(async () => {
                      await post(`/admin/users/${id}/unsuspend`);
                      return 'Unsuspended. They can sign in again.';
                    })
                  }
                >
                  Unsuspend
                </Button>
              ) : (
                <Button
                  variant="danger"
                  size="sm"
                  disabled={busy || self || user.status === 'deleted'}
                  data-testid="admin-open-suspend"
                  onClick={() => setOpen('suspend')}
                >
                  Suspend account
                </Button>
              )}
              <Button
                variant="danger"
                size="sm"
                disabled={busy || self || user.status === 'deleting' || user.status === 'deleted'}
                onClick={() => setOpen('delete-account')}
              >
                Delete account…
              </Button>
            </div>
            {self ? (
              <p className="px-4 pb-4 text-xs text-muted">
                This is your own account, so it cannot be suspended, signed out or deleted from
                here.
              </p>
            ) : null}
          </Card>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
            <Card>
              <CardHeader title="Theses" />
              {user.documentList.length === 0 ? (
                <p className="p-4 text-sm text-muted">No theses yet.</p>
              ) : (
                <div className="relative overflow-x-auto">
                  <table className="w-full min-w-[34rem] text-sm" data-testid="admin-user-theses">
                    <thead className="text-left text-xs text-muted">
                      <tr>
                        <th className="px-4 py-2">Title</th>
                        <th className="px-3 py-2">Words</th>
                        <th className="px-3 py-2">Chapters</th>
                        <th className="px-3 py-2">Updated</th>
                        <th className="px-3 py-2">
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {user.documentList.map((d) => (
                        <tr key={d.id} className="border-t border-line">
                          <td className="px-4 py-2 font-medium">
                            {d.title}
                            {/* R29 (ADR-0114): off the student's list, still stored. */}
                            {d.archivedAt ? (
                              <Badge className="ml-2 align-middle">Archived</Badge>
                            ) : null}
                          </td>
                          <td className="tnum px-3 py-2">{whole(d.words)}</td>
                          <td className="tnum px-3 py-2">{d.chapters}</td>
                          <td className="px-3 py-2 text-xs text-muted">{ago(d.updatedAt)}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-right">
                            <Link
                              href={`/admin/theses/${d.id}`}
                              className="text-xs font-semibold text-accent hover:underline"
                              data-testid="admin-open-thesis"
                            >
                              Open read-only
                            </Link>
                            <button
                              type="button"
                              className="ml-3 text-xs font-semibold text-danger hover:underline"
                              onClick={() =>
                                setOpen({ kind: 'delete-thesis', id: d.id, title: d.title })
                              }
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {/* ADR-0132: chats asked with no thesis. Counted, not shown: no new way into them. */}
              <p
                className="border-t border-line px-4 py-2 text-xs text-muted"
                data-testid="admin-user-research-chats"
              >
                Research chats with no thesis:{' '}
                <span className="tnum">{user.researchChats ?? 0}</span> · erased with the account
              </p>
            </Card>

            <Card>
              <CardHeader title="This month" />
              <ul className="space-y-1.5 p-4 text-sm" data-testid="user-usage">
                {user.usage
                  .filter((x) => x.cap > 0 || x.used > 0)
                  .map((x) => (
                    <li key={x.action} className="flex justify-between gap-3">
                      <span>{actionName(x.action)}</span>
                      <span className={`tnum ${x.used >= x.cap && x.cap > 0 ? 'text-warn' : ''}`}>
                        {x.used} / {x.cap}
                        {x.bonus > 0 ? (
                          <span className="ml-1 text-xs text-accent">(+{x.bonus})</span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                <li className="flex justify-between border-t border-line pt-1.5">
                  <span>AI cost</span>
                  <span className={`tnum ${user.costInr > 100 ? 'text-danger' : ''}`}>
                    {inr(user.costInr)}
                  </span>
                </li>
                <li className="flex justify-between">
                  <span>Times a limit stopped them</span>
                  <span className="tnum">{user.capExceeded}</span>
                </li>
              </ul>
              <div className="px-4 pb-4">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    if (
                      !window.confirm(
                        `Reset this month's limits for ${user.email}? This is logged.`,
                      )
                    )
                      return;
                    void act(async () => {
                      const r = (await post(`/admin/users/${id}/reset-caps`)) as {
                        reset: Array<{ action: string; was: number }>;
                      };
                      return r.reset.length === 0
                        ? 'Nothing to reset: every counter was already at zero.'
                        : `Reset: ${r.reset.map((x) => `${actionName(x.action)} was ${x.was}`).join(', ')}.`;
                    });
                  }}
                >
                  Reset this month&rsquo;s limits
                </Button>
              </div>
            </Card>
          </div>

          <Card className="mt-4">
            <CardHeader title="Recent activity" />
            {user.recentEvents.length === 0 ? (
              <p className="p-4 text-sm text-muted">Nothing logged yet.</p>
            ) : (
              <ul className="divide-y divide-line text-sm" data-testid="user-events">
                {user.recentEvents.map((e) => (
                  <li
                    key={`${e.kind}-${e.createdAt}`}
                    className="grid gap-1 px-4 py-2 sm:grid-cols-[9rem_1fr_auto]"
                  >
                    <span className="text-xs text-muted">{when(e.createdAt)}</span>
                    <span>
                      <span className="font-semibold">{eventName(e.kind)}</span>{' '}
                      <span className="text-muted">{describeEvent(e.kind, e.detail)}</span>
                    </span>
                    <span className="text-xs text-muted">
                      by {byWhom({ ...e, userId: user.id })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <AllowanceDialog
            open={open === 'allowance'}
            name={firstName}
            usage={user.usage}
            busy={busy}
            onClose={() => setOpen(null)}
            onSubmit={(grants, reason) =>
              act(async () => {
                await post(`/admin/users/${id}/allowance`, { grants, reason });
                return `Extra allowance given: ${grants
                  .map((g) => `+${g.units} ${actionName(g.action).toLowerCase()}`)
                  .join(', ')}. It lasts until the end of this month.`;
              })
            }
          />

          <TrialDialog
            open={open === 'trial'}
            name={firstName}
            busy={busy}
            onClose={() => setOpen(null)}
            onSubmit={(days, reason) =>
              act(async () => {
                const r = (await post(`/admin/users/${id}/trial`, { days, reason })) as {
                  trialEndsAt: string;
                };
                return `Free trial extended by ${days} day${days === 1 ? '' : 's'}, until ${when(r.trialEndsAt)}.`;
              })
            }
          />

          <ReasonDialog
            open={open === 'suspend'}
            testId="admin-suspend-dialog"
            title={`Suspend ${user.email}?`}
            body="They are signed out everywhere and cannot sign in again until you unsuspend them. Nothing is deleted."
            reasonLabel="Reason (kept in the log, not shown to them)"
            confirmLabel="Suspend"
            busy={busy}
            onClose={() => setOpen(null)}
            onSubmit={(reason) =>
              act(async () => {
                await post(`/admin/users/${id}/suspend`, { reason });
                return 'Suspended. They have been signed out everywhere.';
              })
            }
          />

          <ReasonDialog
            open={open === 'delete-account'}
            testId="admin-delete-account-dialog"
            title={`Delete ${user.email}?`}
            body="This starts the same seven-day deletion a student can start from their account page. They are signed out now; everything is erased after seven days unless it is cancelled."
            confirmWord={user.email}
            confirmHint="Type their email address to confirm"
            confirmLabel="Start deletion"
            busy={busy}
            onClose={() => setOpen(null)}
            onSubmit={() =>
              act(async () => {
                await post(`/admin/users/${id}/deletion`);
                return 'Deletion started. The account is erased in seven days unless cancelled.';
              })
            }
          />

          {open && typeof open === 'object' ? (
            <ReasonDialog
              open
              testId="admin-delete-thesis-dialog"
              title={`Delete “${open.title}”?`}
              body="The thesis, its chapters, sources, versions and files are removed for good. The student is emailed that an administrator deleted it, with your reason."
              reasonLabel="Reason (sent to the student)"
              confirmWord={open.title.trim().split(/\s+/)[0] ?? ''}
              confirmHint="Type the thesis’s first word to confirm"
              confirmLabel="Delete thesis"
              busy={busy}
              onClose={() => setOpen(null)}
              onSubmit={(reason) =>
                act(async () => {
                  await post(`/admin/theses/${open.id}/delete`, { reason });
                  return `“${open.title}” was deleted, and the student was emailed.`;
                })
              }
            />
          ) : null}
        </>
      ) : null}
    </main>
  );
}

function AllowanceDialog({
  open,
  name,
  usage,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  name: string;
  usage: UserDetail['usage'];
  busy: boolean;
  onClose: () => void;
  onSubmit: (grants: Array<{ action: string; units: number }>, reason: string) => void;
}) {
  const [units, setUnits] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const nextMonth = new Date();
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1, 1);
  const grants = Object.entries(units)
    .map(([action, v]) => ({ action, units: Number(v) || 0 }))
    .filter((g) => g.units > 0);
  const valid = grants.length > 0 && reason.trim().length >= 3;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Give ${name} extra allowance`}
      testId="admin-allowance-dialog"
    >
      <p className="text-muted">
        Added on top of their plan for this month only. Resets on{' '}
        {nextMonth.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}.
      </p>
      <div className="mt-3 grid grid-cols-[1fr_6rem] items-center gap-x-3 gap-y-2">
        {usage.map((x) => (
          <div key={x.action} className="contents">
            <label htmlFor={`allowance-${x.action}`}>
              {actionName(x.action)}{' '}
              <span className="text-xs text-muted">
                ({x.used}/{x.cap})
              </span>
            </label>
            <Input
              id={`allowance-${x.action}`}
              type="number"
              min={0}
              max={1000}
              inputMode="numeric"
              placeholder="+0"
              value={units[x.action] ?? ''}
              onChange={(e) => setUnits((u) => ({ ...u, [x.action]: e.target.value }))}
              data-testid={`allowance-${x.action}`}
            />
          </div>
        ))}
      </div>
      <Label className="mt-4 block" htmlFor="allowance-reason">
        Reason (kept in the log)
      </Label>
      <Textarea
        id="allowance-reason"
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        data-testid="allowance-reason"
      />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={!valid || busy}
          data-testid="allowance-submit"
          onClick={() => onSubmit(grants, reason.trim())}
        >
          {busy ? 'Giving…' : 'Give allowance'}
        </Button>
      </div>
    </Dialog>
  );
}

function TrialDialog({
  open,
  name,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  name: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (days: number, reason: string) => void;
}) {
  const [days, setDays] = useState('7');
  const [reason, setReason] = useState('');
  const n = Number(days);
  const valid = Number.isInteger(n) && n >= 1 && n <= 365 && reason.trim().length >= 3;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Extend ${name}’s free trial`}
      testId="admin-trial-dialog"
    >
      <p className="text-muted">
        Counted from today, or from the current end if that is later. Their AI allowances come back
        at once if the trial had ended.
      </p>
      <Label className="mt-4 block" htmlFor="trial-days">
        Extra days
      </Label>
      <Input
        id="trial-days"
        type="number"
        min={1}
        max={365}
        inputMode="numeric"
        value={days}
        onChange={(e) => setDays(e.target.value)}
        data-testid="trial-days"
      />
      <Label className="mt-4 block" htmlFor="trial-reason">
        Reason (kept in the log)
      </Label>
      <Textarea
        id="trial-reason"
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        data-testid="trial-reason"
      />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={!valid || busy}
          data-testid="trial-submit"
          onClick={() => onSubmit(n, reason.trim())}
        >
          {busy ? 'Extending…' : 'Extend trial'}
        </Button>
      </div>
    </Dialog>
  );
}

function ReasonDialog({
  open,
  testId,
  title,
  body,
  reasonLabel,
  confirmWord,
  confirmHint,
  confirmLabel,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  testId: string;
  title: string;
  body: string;
  /** When set, a reason is asked for and required. */
  reasonLabel?: string;
  /** When set, this must be typed before the button works. */
  confirmWord?: string;
  confirmHint?: string;
  confirmLabel: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const reasonOk = !reasonLabel || reason.trim().length >= 3;
  const typedOk = !confirmWord || typed.trim().toLowerCase() === confirmWord.toLowerCase();
  return (
    <Dialog open={open} onClose={onClose} title={title} testId={testId}>
      <p className="text-muted">{body}</p>
      {confirmWord ? (
        <>
          <Label className="mt-4 block" htmlFor={`${testId}-confirm`}>
            {confirmHint}: <span className="font-mono text-ink">{confirmWord}</span>
          </Label>
          <Input
            id={`${testId}-confirm`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            data-testid={`${testId}-confirm`}
          />
        </>
      ) : null}
      {reasonLabel ? (
        <>
          <Label className="mt-4 block" htmlFor={`${testId}-reason`}>
            {reasonLabel}
          </Label>
          <Textarea
            id={`${testId}-reason`}
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            data-testid={`${testId}-reason`}
          />
        </>
      ) : null}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="danger"
          disabled={!reasonOk || !typedOk || busy}
          data-testid={`${testId}-submit`}
          onClick={() => onSubmit(reason.trim())}
        >
          {busy ? 'Working…' : confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
