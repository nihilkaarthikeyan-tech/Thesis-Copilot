'use client';

/**
 * `/app/account` — PRD FR-9.5, §2.5, PHASES v2 W11.2.
 *
 *   "cancel from account page on any device"
 *
 * §2.5 is the whole design brief for this screen: the product we are measured against is
 * one-starred for a cancel button that only exists on desktop, buried. This one is the first
 * thing under the plan, works at 375 px, takes one click plus a confirmation, and says exactly
 * what happens next — including that nothing is deleted.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/auth-client';
import { passwordProblem } from '@/lib/password';

type Billing = {
  plan: string;
  status: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  unavailableReason: string | null;
  plans: Array<{ plan: string; priceInr: number; period: string; blurb: string; current: boolean }>;
};

type Invoice = {
  id: string;
  number: string;
  date: string;
  amountInr: number;
};

type Deletion = {
  requestedAt: string | null;
  erasesAt: string | null;
  graceDays: number;
};

type Usage = {
  plan: string;
  resetsAt: string;
  actions: Array<{ action: string; used: number; cap: number; remaining: number }>;
};

const PLAN_LABEL: Record<string, string> = {
  FREE_TRIAL: 'Free trial',
  STUDENT_MONTHLY: 'Student, monthly',
  STUDENT_ANNUAL: 'Student, annual',
  INSTITUTION_SEAT: 'Institution seat',
};

const ACTION_LABEL: Record<string, string> = {
  ASSIST: 'Assist suggestions',
  DRAFT: 'Draft sections',
  CITE: 'Citation suggestions',
  CHAT: 'Questions to your library',
  COMMAND: 'Section commands',
  COHERENCE: 'Coherence checks',
};

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—');

export default function AccountPage() {
  const [billing, setBilling] = useState<Billing | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deletion, setDeletion] = useState<Deletion | null>(null);
  const [deleting, setDeleting] = useState(false);
  // ADR-0015. `stage` rather than two booleans: the three states are exclusive, and a screen that
  // can show both "enter an address" and "enter the code" is a screen that will.
  const [emailStage, setEmailStage] = useState<'idle' | 'address' | 'code'>('idle');
  const [newEmail, setNewEmail] = useState('');
  const [emailOtp, setEmailOtp] = useState('');
  const [emailChanged, setEmailChanged] = useState<string | null>(null);
  const [confirmEmail, setConfirmEmail] = useState('');
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // ADR-0033. `null` until the API has said whether a password exists.
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [pwStage, setPwStage] = useState<'idle' | 'set' | 'change'>('idle');
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwRepeat, setPwRepeat] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwNotice, setPwNotice] = useState<string | null>(null);

  const session = useSession();
  // The confirm response is the authority once the change lands: the session's copy is a snapshot
  // taken before it, and nothing forces a refetch at that moment.
  const currentEmail = emailChanged ?? session.data?.user.email ?? null;

  const load = useCallback(() => {
    api<Billing>('/billing')
      .then(setBilling)
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.problem.title : 'Could not load your plan.'),
      );
    api<Usage>('/usage/me')
      .then(setUsage)
      .catch(() => undefined);
    api<Invoice[]>('/billing/invoices')
      .then(setInvoices)
      .catch(() => undefined);
    api<Deletion>('/account/deletion')
      .then(setDeletion)
      .catch(() => undefined);
    api<{ hasPassword: boolean }>('/account/password')
      .then((s) => setHasPassword(s.hasPassword))
      .catch(() => undefined);
  }, []);

  function resetPasswordForm() {
    setPwStage('idle');
    setPwCurrent('');
    setPwNew('');
    setPwRepeat('');
    setPwError(null);
  }

  async function savePassword() {
    const problem = passwordProblem(pwNew, pwRepeat);
    if (problem) {
      setPwError(problem);
      return;
    }
    setBusy(true);
    setPwError(null);
    setPwNotice(null);
    try {
      if (pwStage === 'set') {
        await api<{ ok: true }>('/account/password', {
          method: 'POST',
          body: JSON.stringify({ newPassword: pwNew }),
        });
        setPwNotice('Your password is set. You can sign in with it or with an emailed code.');
      } else {
        await api<{ ok: true }>('/account/password/change', {
          method: 'POST',
          body: JSON.stringify({ currentPassword: pwCurrent, newPassword: pwNew }),
        });
        setPwNotice('Your password is changed, and every other device has been signed out.');
      }
      setHasPassword(true);
      resetPasswordForm();
    } catch (e) {
      setPwError(
        e instanceof ApiError
          ? (e.problem.detail ?? e.problem.title)
          : 'Could not save the password. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  useEffect(load, [load]);

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      const updated = await api<Billing>('/billing/cancel', { method: 'POST', body: '{}' });
      setBilling(updated);
      setConfirming(false);
      setNotice(
        `Cancelled. You keep everything until ${date(updated.currentPeriodEnd)}, and nothing is deleted after that.`,
      );
    } catch (e) {
      setError(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not cancel.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount() {
    setBusy(true);
    setError(null);
    try {
      const status = await api<Deletion>('/account', {
        method: 'DELETE',
        body: JSON.stringify({ confirmEmail }),
      });
      setDeletion(status);
      setDeleting(false);
      setConfirmEmail('');
      setSignedOut(true);
      setNotice(null);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? (e.problem.detail ?? e.problem.title)
          : 'Could not schedule the deletion.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function keepAccount() {
    setBusy(true);
    setError(null);
    try {
      setDeletion(await api<Deletion>('/account/deletion/cancel', { method: 'POST', body: '{}' }));
      setSignedOut(false);
      setNotice('Your account is staying. Nothing was deleted.');
    } catch (e) {
      setError(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not cancel.');
    } finally {
      setBusy(false);
    }
  }

  function resetEmailChange() {
    setEmailStage('idle');
    setNewEmail('');
    setEmailOtp('');
  }

  async function sendEmailCode() {
    setBusy(true);
    setError(null);
    try {
      await api<{ sent: true }>('/account/email', {
        method: 'POST',
        body: JSON.stringify({ newEmail }),
      });
      setEmailStage('code');
      setNotice(null);
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not send the code.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirmEmailChange() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ email: string }>('/account/email/verify', {
        method: 'POST',
        body: JSON.stringify({ newEmail, otp: emailOtp }),
      });
      setEmailChanged(result.email);
      resetEmailChange();
      setNotice(`You now sign in with ${result.email}.`);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? (e.problem.detail ?? e.problem.title)
          : 'Could not change the address.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function subscribe(plan: string) {
    setBusy(true);
    setError(null);
    try {
      const handle = await api<{ subscriptionId: string; keyId: string }>('/billing/subscribe', {
        method: 'POST',
        body: JSON.stringify({ plan }),
      });
      // Razorpay's checkout runs in their own hosted page; the browser never holds a card number
      // and this application never sees one (§12.1).
      window.location.href = `https://api.razorpay.com/v1/checkout/embedded?subscription_id=${encodeURIComponent(handle.subscriptionId)}&key_id=${encodeURIComponent(handle.keyId)}`;
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not start checkout.',
      );
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-12">
      <nav className="text-xs text-muted">
        <Link href="/app" className="hover:underline">
          Theses
        </Link>{' '}
        / Account
      </nav>
      <h1 className="mt-2 text-balance text-[28px] font-bold leading-tight tracking-[-0.02em] text-ink">
        Account
      </h1>

      {error ? (
        <p role="alert" className="mt-4 text-sm text-warn">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" data-testid="billing-notice" className="mt-4 text-sm">
          {notice}
        </p>
      ) : null}

      <section
        className="mt-6 rounded-md border border-line bg-surface p-4"
        data-testid="plan-card"
      >
        <p className="text-xs text-muted">Your plan</p>
        <p className="mt-1 text-lg">{PLAN_LABEL[billing?.plan ?? ''] ?? billing?.plan ?? '…'}</p>
        {billing?.currentPeriodEnd && billing.status !== null ? (
          <p className="mt-1 text-sm text-muted">
            {billing.cancelAtPeriodEnd
              ? `Cancelled — access continues until ${date(billing.currentPeriodEnd)}.`
              : billing.status === 'past_due'
                ? `Payment did not go through. You keep everything for three days after ${date(billing.currentPeriodEnd)}, then move to the free allowances. Nothing is deleted.`
                : `Renews on ${date(billing.currentPeriodEnd)}. We will email you three days before.`}
          </p>
        ) : null}

        {/* FR-9.5: one click, any device, always the first control on the card. */}
        {billing?.status && !billing.cancelAtPeriodEnd && billing.plan !== 'FREE_TRIAL' ? (
          confirming ? (
            <div className="mt-3 rounded-md border border-line p-3 text-sm">
              <p>
                Cancel your subscription? It will not renew. You keep everything until{' '}
                {date(billing.currentPeriodEnd)}, and your theses, sources and exports stay exactly
                as they are.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void cancel()}
                  data-testid="confirm-cancel"
                  className="rounded-md bg-warn px-4 py-2 text-sm text-paper disabled:opacity-50"
                >
                  {busy ? 'Cancelling…' : 'Yes, cancel'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-sunk"
                >
                  Keep it
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              data-testid="cancel-subscription"
              className="mt-3 w-full rounded-md border border-line-strong bg-surface px-4 py-2 text-sm sm:w-auto font-semibold text-ink transition-colors hover:bg-sunk"
            >
              Cancel subscription
            </button>
          )
        ) : null}
      </section>

      {billing && (billing.plan === 'FREE_TRIAL' || billing.cancelAtPeriodEnd) ? (
        <section className="mt-6">
          <h2 className="text-balance text-[17px] font-bold leading-snug text-ink">Plans</h2>
          {billing.unavailableReason ? (
            <p className="mt-2 text-sm text-muted">
              {billing.unavailableReason} During the pilot your allowances are set by hand — email
              us and we will move you.
            </p>
          ) : null}
          <ul className="mt-3 space-y-3">
            {billing.plans.map((plan) => (
              <li key={plan.plan} className="rounded-md border border-line bg-surface p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium">{PLAN_LABEL[plan.plan] ?? plan.plan}</p>
                  <p className="text-lg">
                    ₹{plan.priceInr}
                    <span className="text-xs text-muted">
                      {plan.period === 'yearly' ? ' / year' : ' / month'}
                    </span>
                  </p>
                </div>
                <p className="mt-1 text-sm text-muted">{plan.blurb}</p>
                <button
                  type="button"
                  disabled={busy || billing.unavailableReason !== null}
                  onClick={() => void subscribe(plan.plan)}
                  className="mt-3 w-full rounded-md px-4 py-2 text-sm disabled:opacity-50 sm:w-auto bg-accent text-accent-ink hover:bg-accent-hover font-semibold transition-colors"
                >
                  Choose {PLAN_LABEL[plan.plan] ?? plan.plan}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">
            Payment is handled by Razorpay. We never see your card or UPI details.{' '}
            <Link href="/refunds" className="underline">
              Refund policy
            </Link>
            .
          </p>
        </section>
      ) : null}

      <section className="mt-6 rounded-md border border-line bg-surface p-4">
        <h2 className="eyebrow">This month</h2>
        {usage ? (
          <>
            <ul className="mt-2 space-y-1 text-sm" data-testid="account-usage">
              {usage.actions.map((a) => (
                <li key={a.action} className="flex items-baseline justify-between gap-3">
                  <span>{ACTION_LABEL[a.action] ?? a.action}</span>
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="hidden h-1.5 w-24 overflow-hidden rounded bg-line sm:block"
                    >
                      <span
                        className={`block h-full ${a.remaining === 0 ? 'bg-warn' : 'bg-accent'}`}
                        style={{
                          width: `${a.cap > 0 ? Math.min(100, (a.used / a.cap) * 100) : 0}%`,
                        }}
                      />
                    </span>
                    <span className={a.remaining === 0 ? 'text-warn' : 'text-muted'}>
                      {a.used} / {a.cap}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted">
              Resets on {date(usage.resetsAt)}. A suggestion counts when it is generated, whether
              you keep it or dismiss it — the tokens were spent either way. Nothing you type counts.
            </p>
          </>
        ) : (
          <p className="mt-2 text-sm text-muted">Loading…</p>
        )}
      </section>

      {invoices.length > 0 ? (
        <section className="mt-6 rounded-md border border-line bg-surface p-4">
          <h2 className="eyebrow">Invoices</h2>
          <ul className="mt-2 space-y-1 text-sm" data-testid="invoices">
            {invoices.map((invoice) => (
              <li key={invoice.id} className="flex items-baseline justify-between gap-3">
                <span>
                  {invoice.number}
                  <span className="ml-2 text-xs text-muted">{date(invoice.date)}</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-muted">₹{invoice.amountInr}</span>
                  <button
                    type="button"
                    className="underline"
                    onClick={() => {
                      void api<{ url: string }>(`/billing/invoices/${invoice.id}`, {
                        method: 'POST',
                        body: '{}',
                      })
                        .then(({ url }) => window.open(url, '_blank', 'noopener,noreferrer'))
                        .catch(() => setError('That invoice could not be produced.'));
                    }}
                  >
                    PDF
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section
        className="mt-6 rounded-md border border-line bg-surface p-4"
        data-testid="email-card"
      >
        <h2 className="eyebrow">Email address</h2>
        <p className="mt-2 text-sm">
          You sign in with <strong data-testid="current-email">{currentEmail ?? '…'}</strong>.
        </p>

        {emailStage === 'idle' ? (
          <>
            <p className="mt-2 text-sm text-muted">
              {hasPassword
                ? 'The code we email you and your password both belong to this address, so changing it changes how you sign in. Move it before you lose access to a university mailbox.'
                : 'There is no password on this account — the code we email you is how you get in. So changing this address changes how you sign in. Move it before you lose access to a university mailbox.'}
            </p>
            <button
              type="button"
              onClick={() => setEmailStage('address')}
              data-testid="change-email"
              className="mt-3 w-full rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-sunk sm:w-auto"
            >
              Change email
            </button>
          </>
        ) : emailStage === 'address' ? (
          <div className="mt-3 rounded-md border border-line p-3 text-sm">
            <label htmlFor="new-email" className="block text-xs text-muted">
              The address you want to sign in with
            </label>
            <input
              id="new-email"
              type="email"
              autoComplete="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              data-testid="new-email"
              className="mt-1 w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink"
            />
            <p className="mt-2 text-muted">
              We will send a code there to check you can read it. Nothing changes until you enter
              it, and we will tell {currentEmail ?? 'your current address'} that this was asked for.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || newEmail.trim() === ''}
                onClick={() => void sendEmailCode()}
                data-testid="send-email-code"
                className="rounded-md bg-ink px-4 py-2 text-sm text-paper disabled:opacity-50"
              >
                {busy ? 'Sending…' : 'Send the code'}
              </button>
              <button
                type="button"
                onClick={resetEmailChange}
                className="rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-sunk"
              >
                Never mind
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 rounded-md border border-line p-3 text-sm">
            <p>
              We sent a six-digit code to <strong>{newEmail}</strong>. It expires in ten minutes.
            </p>
            <p className="mt-2 text-muted">
              If nothing arrives, check that the address is right — for your safety this page does
              not say whether an address already belongs to another account.
            </p>
            <label htmlFor="email-otp" className="mt-3 block text-xs text-muted">
              The code from that inbox
            </label>
            <input
              id="email-otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={emailOtp}
              onChange={(e) => setEmailOtp(e.target.value)}
              data-testid="email-otp"
              className="mt-1 w-full rounded-md border border-line bg-paper px-3 py-2 text-sm tracking-widest text-ink"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || emailOtp.trim() === ''}
                onClick={() => void confirmEmailChange()}
                data-testid="confirm-email-change"
                className="rounded-md bg-ink px-4 py-2 text-sm text-paper disabled:opacity-50"
              >
                {busy ? 'Changing…' : 'Change my address'}
              </button>
              <button
                type="button"
                onClick={resetEmailChange}
                className="rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-sunk"
              >
                Never mind
              </button>
            </div>
          </div>
        )}
      </section>

      <section
        className="mt-6 rounded-md border border-line bg-surface p-4"
        data-testid="password-card"
      >
        <h2 className="eyebrow">Password</h2>
        {hasPassword === null ? (
          <p className="mt-2 text-sm text-muted">Checking…</p>
        ) : pwStage === 'idle' ? (
          <>
            <p className="mt-2 text-sm text-muted" data-testid="password-status">
              {hasPassword
                ? 'You can sign in with your password or with an emailed code.'
                : 'This account has no password: the code we email you is how you sign in, and that keeps working. Add a password if you would rather type one.'}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setPwNotice(null);
                  setPwStage(hasPassword ? 'change' : 'set');
                }}
                data-testid={hasPassword ? 'change-password' : 'add-password'}
                className="w-full rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-sunk sm:w-auto"
              >
                {hasPassword ? 'Change password' : 'Add a password'}
              </button>
              {hasPassword ? (
                <Link
                  href="/forgot-password"
                  className="text-sm text-muted underline underline-offset-2 hover:text-ink"
                >
                  Forgotten it? Reset by email
                </Link>
              ) : null}
            </div>
          </>
        ) : (
          <div className="mt-3 rounded-md border border-line p-3 text-sm">
            {pwStage === 'change' ? (
              <>
                <label htmlFor="pw-current" className="block text-xs text-muted">
                  Current password
                </label>
                <input
                  id="pw-current"
                  type="password"
                  autoComplete="current-password"
                  value={pwCurrent}
                  onChange={(e) => setPwCurrent(e.target.value)}
                  data-testid="pw-current"
                  className="mt-1 w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink"
                />
              </>
            ) : null}
            <label htmlFor="pw-new" className="mt-3 block text-xs text-muted">
              New password — at least 10 characters; a short sentence is ideal
            </label>
            <input
              id="pw-new"
              type="password"
              autoComplete="new-password"
              value={pwNew}
              onChange={(e) => setPwNew(e.target.value)}
              data-testid="pw-new"
              className="mt-1 w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink"
            />
            <label htmlFor="pw-repeat" className="mt-3 block text-xs text-muted">
              The same again
            </label>
            <input
              id="pw-repeat"
              type="password"
              autoComplete="new-password"
              value={pwRepeat}
              onChange={(e) => setPwRepeat(e.target.value)}
              data-testid="pw-repeat"
              className="mt-1 w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink"
            />
            {pwStage === 'change' ? (
              <p className="mt-2 text-muted">
                Every other device is signed out when the password changes.
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={
                  busy ||
                  pwNew === '' ||
                  pwRepeat === '' ||
                  (pwStage === 'change' && pwCurrent === '')
                }
                onClick={() => void savePassword()}
                data-testid="save-password"
                className="rounded-md bg-ink px-4 py-2 text-sm text-paper disabled:opacity-50"
              >
                {busy ? 'Saving…' : pwStage === 'set' ? 'Save password' : 'Change password'}
              </button>
              <button
                type="button"
                onClick={resetPasswordForm}
                className="rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-sunk"
              >
                Never mind
              </button>
            </div>
          </div>
        )}
        {pwError ? (
          <p role="alert" className="mt-3 text-sm text-danger" data-testid="password-error">
            {pwError}
          </p>
        ) : null}
        {pwNotice ? (
          <p role="status" className="mt-3 text-sm" data-testid="password-notice">
            {pwNotice}
          </p>
        ) : null}
      </section>

      <section className="mt-6 rounded-md border border-line bg-surface p-4">
        <h2 className="eyebrow">Delete your account</h2>

        {deletion?.requestedAt && signedOut ? (
          <>
            <p className="mt-2 text-sm">
              Scheduled. Your account and everything in it will be erased on{' '}
              <strong>{date(deletion.erasesAt)}</strong>.
            </p>
            <p className="mt-2 text-sm text-muted">
              You have been signed out on every device, including this one. That is deliberate: if
              this request was not yours, whoever made it no longer has a way in.
            </p>
            <p className="mt-2 text-sm text-muted">
              To undo it, sign in again with your email and choose <strong>Keep my account</strong>.
              Nothing is deleted until {date(deletion.erasesAt)}.
            </p>
            <Link
              href="/sign-in"
              data-testid="deletion-signin"
              className="mt-3 inline-block rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-sunk"
            >
              Sign in again
            </Link>
          </>
        ) : deletion?.requestedAt ? (
          <>
            <p className="mt-2 text-sm">
              Your account and everything in it will be erased on{' '}
              <strong>{date(deletion.erasesAt)}</strong>.
            </p>
            <p className="mt-2 text-sm text-muted">
              Change your mind any time before then and nothing is lost.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void keepAccount()}
              data-testid="cancel-deletion"
              className="mt-3 w-full rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-sunk disabled:opacity-50 sm:w-auto"
            >
              {busy ? 'Cancelling…' : 'Keep my account'}
            </button>
          </>
        ) : deleting ? (
          <div className="mt-3 rounded-md border border-line p-3 text-sm">
            <p>
              This deletes your theses, chapters, sources, uploaded PDFs, exports and comments.{' '}
              <strong>It cannot be undone once it runs.</strong> Export anything you want to keep
              first — that works on any plan.
            </p>
            <p className="mt-2 text-muted">
              Nothing happens for {deletion?.graceDays ?? 7} days. Until then you can change your
              mind here. Your payment records are kept, because the law requires it.
            </p>
            <label htmlFor="confirm-email" className="mt-3 block text-xs text-muted">
              Type your email address to confirm
            </label>
            <input
              id="confirm-email"
              type="email"
              autoComplete="off"
              value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)}
              data-testid="confirm-email"
              className="mt-1 w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || confirmEmail.trim() === ''}
                onClick={() => void deleteAccount()}
                data-testid="confirm-delete"
                className="rounded-md bg-danger px-4 py-2 text-sm text-paper disabled:opacity-50"
              >
                {busy ? 'Scheduling…' : 'Delete my account'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDeleting(false);
                  setConfirmEmail('');
                }}
                className="rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-sunk"
              >
                Never mind
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="mt-2 text-sm text-muted">
              Erases your theses, sources, files and exports. You get {deletion?.graceDays ?? 7}{' '}
              days to change your mind.
            </p>
            <button
              type="button"
              onClick={() => setDeleting(true)}
              data-testid="delete-account"
              className="mt-3 w-full rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-semibold text-danger transition-colors hover:bg-sunk sm:w-auto"
            >
              Delete account
            </button>
          </>
        )}
      </section>

      <p className="mt-6 text-xs text-muted">
        <Link href="/app/settings" className="underline">
          Settings
        </Link>{' '}
        ·{' '}
        <Link href="/privacy" className="underline">
          Privacy
        </Link>{' '}
        ·{' '}
        <Link href="/pricing" className="underline">
          Pricing
        </Link>
      </p>
    </main>
  );
}
