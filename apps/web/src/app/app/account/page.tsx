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
import { TrialNotice } from '@/components/TrialNotice';
import { tNow } from '@/i18n';
import { useT } from '@/i18n/react';
import { allowanceName, includedAllowances, notIncluded } from '@/lib/action-names';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/auth-client';
import { formatResetDate } from '@/lib/limit';
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

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—');

export default function AccountPage() {
  const { t, rich } = useT();
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
  // ADR-0142. `null` until /settings has answered; on unless the student turned it off.
  const [commentEmails, setCommentEmails] = useState<boolean | null>(null);

  const session = useSession();
  // The confirm response is the authority once the change lands: the session's copy is a snapshot
  // taken before it, and nothing forces a refetch at that moment.
  const currentEmail = emailChanged ?? session.data?.user.email ?? null;

  const load = useCallback(() => {
    api<Billing>('/billing')
      .then(setBilling)
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.problem.title : tNow('account.loadError')),
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
    api<{ emailOnComments?: boolean }>('/settings')
      .then((s) => setCommentEmails(s.emailOnComments !== false))
      .catch(() => undefined);
  }, []);

  async function toggleCommentEmails() {
    if (commentEmails === null) return;
    const next = !commentEmails;
    setCommentEmails(next);
    try {
      await api('/settings', { method: 'PUT', body: JSON.stringify({ emailOnComments: next }) });
    } catch (e) {
      setCommentEmails(!next);
      setError(e instanceof ApiError ? e.problem.title : tNow('account.loadError'));
    }
  }

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
        setPwNotice(tNow('account.pwSet'));
      } else {
        await api<{ ok: true }>('/account/password/change', {
          method: 'POST',
          body: JSON.stringify({ currentPassword: pwCurrent, newPassword: pwNew }),
        });
        setPwNotice(tNow('account.pwChanged'));
      }
      setHasPassword(true);
      resetPasswordForm();
    } catch (e) {
      setPwError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : tNow('account.pwSaveError'),
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
      setNotice(tNow('account.cancelDone', { date: date(updated.currentPeriodEnd) }));
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : tNow('account.cancelError'),
      );
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
          : tNow('account.scheduleError'),
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
      setNotice(tNow('account.staying'));
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : tNow('account.cancelError'),
      );
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
        e instanceof ApiError
          ? (e.problem.detail ?? e.problem.title)
          : tNow('account.sendCodeError'),
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
      setNotice(tNow('account.nowSignIn', { email: result.email }));
    } catch (e) {
      setError(
        e instanceof ApiError
          ? (e.problem.detail ?? e.problem.title)
          : tNow('account.changeEmailError'),
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
        e instanceof ApiError
          ? (e.problem.detail ?? e.problem.title)
          : tNow('account.checkoutError'),
      );
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-12">
      <nav className="text-xs text-muted">
        <Link href="/app" className="hover:underline">
          {t('common.theses')}
        </Link>{' '}
        / {t('common.account')}
      </nav>
      <h1 className="mt-2 text-balance text-[28px] font-bold leading-tight tracking-[-0.02em] text-ink">
        {t('common.account')}
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
        <p className="text-xs text-muted">{t('account.yourPlan')}</p>
        <p className="mt-1 text-lg">{PLAN_LABEL[billing?.plan ?? ''] ?? billing?.plan ?? '…'}</p>
        {billing?.currentPeriodEnd && billing.status !== null ? (
          <p className="mt-1 text-sm text-muted">
            {billing.cancelAtPeriodEnd
              ? t('account.cancelled', { date: date(billing.currentPeriodEnd) })
              : billing.status === 'past_due'
                ? t('account.pastDue', { date: date(billing.currentPeriodEnd) })
                : t('account.renews', { date: date(billing.currentPeriodEnd) })}
          </p>
        ) : null}

        {/* FR-9.5: one click, any device, always the first control on the card. */}
        {billing?.status && !billing.cancelAtPeriodEnd && billing.plan !== 'FREE_TRIAL' ? (
          confirming ? (
            <div className="mt-3 rounded-md border border-line p-3 text-sm">
              <p>{t('account.cancelConfirm', { date: date(billing.currentPeriodEnd) })}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void cancel()}
                  data-testid="confirm-cancel"
                  className="rounded-md bg-warn px-4 py-2 text-sm text-paper disabled:opacity-50"
                >
                  {busy ? t('account.cancelling') : t('account.yesCancel')}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-sunk"
                >
                  {t('account.keepIt')}
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
              {t('account.cancelSubscription')}
            </button>
          )
        ) : null}
      </section>

      {billing && (billing.plan === 'FREE_TRIAL' || billing.cancelAtPeriodEnd) ? (
        <section className="mt-6">
          <h2 className="text-balance text-[17px] font-bold leading-snug text-ink">
            {t('account.plans')}
          </h2>
          {billing.unavailableReason ? (
            <p className="mt-2 text-sm text-muted">
              {billing.unavailableReason} {t('account.pilotNote')}
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
                      {plan.period === 'yearly' ? t('account.perYear') : t('account.perMonth')}
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
                  {t('account.choose', { plan: PLAN_LABEL[plan.plan] ?? plan.plan })}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">
            {t('account.razorpay')}{' '}
            <Link href="/refunds" className="underline">
              {t('account.refundPolicy')}
            </Link>
            .
          </p>
        </section>
      ) : null}

      <TrialNotice className="mt-6" />

      <section className="mt-6 rounded-md border border-line bg-surface p-4">
        <h2 className="eyebrow">{t('common.thisMonth')}</h2>
        {usage ? (
          <>
            <ul className="mt-2 space-y-1 text-sm" data-testid="account-usage">
              {includedAllowances(usage.actions).map((a) => (
                <li key={a.action} className="flex items-baseline justify-between gap-3">
                  <span>{allowanceName(a.action)}</span>
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
            {notIncluded(usage.actions) ? (
              <p className="mt-2 text-xs text-muted" data-testid="account-not-included">
                {t('common.notIncluded', { list: notIncluded(usage.actions) })}
              </p>
            ) : null}
            <p className="mt-3 text-xs text-muted">
              {t('account.resets', { date: formatResetDate(usage.resetsAt) })}
            </p>
          </>
        ) : (
          <p className="mt-2 text-sm text-muted">{t('common.loading')}</p>
        )}
      </section>

      {invoices.length > 0 ? (
        <section className="mt-6 rounded-md border border-line bg-surface p-4">
          <h2 className="eyebrow">{t('account.invoices')}</h2>
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
                        .catch(() => setError(tNow('account.invoiceError')));
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

      <section className="mt-6 rounded-md border border-line bg-surface p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="eyebrow">{t('account.commentEmail.title')}</h2>
            <p className="mt-1 text-sm text-muted">{t('account.commentEmail.body')}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={commentEmails !== false}
            aria-label={t('account.commentEmail.title')}
            disabled={commentEmails === null}
            onClick={() => void toggleCommentEmails()}
            data-testid="comment-email-toggle"
            className={`shrink-0 rounded-full px-3 py-1 text-xs ${
              commentEmails !== false
                ? 'bg-accent text-accent-ink'
                : 'border border-line text-muted'
            }`}
          >
            {commentEmails !== false ? t('common.on') : t('common.off')}
          </button>
        </div>
      </section>

      <section
        className="mt-6 rounded-md border border-line bg-surface p-4"
        data-testid="email-card"
      >
        <h2 className="eyebrow">{t('account.emailTitle')}</h2>
        <p className="mt-2 text-sm">
          {rich('account.signInWith', {
            email: <strong data-testid="current-email">{currentEmail ?? '…'}</strong>,
          })}
        </p>

        {emailStage === 'idle' ? (
          <>
            <p className="mt-2 text-sm text-muted">
              {hasPassword ? t('account.emailWithPassword') : t('account.emailNoPassword')}
            </p>
            <button
              type="button"
              onClick={() => setEmailStage('address')}
              data-testid="change-email"
              className="mt-3 w-full rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-sunk sm:w-auto"
            >
              {t('account.changeEmail')}
            </button>
          </>
        ) : emailStage === 'address' ? (
          <div className="mt-3 rounded-md border border-line p-3 text-sm">
            <label htmlFor="new-email" className="block text-xs text-muted">
              {t('account.newEmailLabel')}
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
              {t('account.newEmailNote', {
                current: currentEmail ?? t('account.yourCurrentAddress'),
              })}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || newEmail.trim() === ''}
                onClick={() => void sendEmailCode()}
                data-testid="send-email-code"
                className="rounded-md bg-ink px-4 py-2 text-sm text-paper disabled:opacity-50"
              >
                {busy ? t('common.sending') : t('account.sendCode')}
              </button>
              <button
                type="button"
                onClick={resetEmailChange}
                className="rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-sunk"
              >
                {t('common.neverMind')}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 rounded-md border border-line p-3 text-sm">
            <p>{rich('account.codeSent', { email: <strong>{newEmail}</strong> })}</p>
            <p className="mt-2 text-muted">{t('account.codeSafety')}</p>
            <label htmlFor="email-otp" className="mt-3 block text-xs text-muted">
              {t('account.codeLabel')}
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
                {busy ? t('account.changing') : t('account.changeMyAddress')}
              </button>
              <button
                type="button"
                onClick={resetEmailChange}
                className="rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-sunk"
              >
                {t('common.neverMind')}
              </button>
            </div>
          </div>
        )}
      </section>

      <section
        className="mt-6 rounded-md border border-line bg-surface p-4"
        data-testid="password-card"
      >
        <h2 className="eyebrow">{t('account.passwordTitle')}</h2>
        {hasPassword === null ? (
          <p className="mt-2 text-sm text-muted">{t('account.checking')}</p>
        ) : pwStage === 'idle' ? (
          <>
            <p className="mt-2 text-sm text-muted" data-testid="password-status">
              {hasPassword ? t('account.hasPassword') : t('account.noPassword')}
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
                {hasPassword ? t('account.changePassword') : t('account.addPassword')}
              </button>
              {hasPassword ? (
                <Link
                  href="/forgot-password"
                  className="text-sm text-muted underline underline-offset-2 hover:text-ink"
                >
                  {t('account.forgotten')}
                </Link>
              ) : null}
            </div>
          </>
        ) : (
          <div className="mt-3 rounded-md border border-line p-3 text-sm">
            {pwStage === 'change' ? (
              <>
                <label htmlFor="pw-current" className="block text-xs text-muted">
                  {t('account.currentPassword')}
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
              {t('account.newPassword')}
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
              {t('account.repeatPassword')}
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
              <p className="mt-2 text-muted">{t('account.otherDevices')}</p>
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
                {busy
                  ? t('common.saving')
                  : pwStage === 'set'
                    ? t('account.savePassword')
                    : t('account.changePassword')}
              </button>
              <button
                type="button"
                onClick={resetPasswordForm}
                className="rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-sunk"
              >
                {t('common.neverMind')}
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
        <h2 className="eyebrow">{t('account.deleteTitle')}</h2>

        {deletion?.requestedAt && signedOut ? (
          <>
            <p className="mt-2 text-sm">
              {rich('account.scheduled', { date: <strong>{date(deletion.erasesAt)}</strong> })}
            </p>
            <p className="mt-2 text-sm text-muted">{t('account.signedOutEverywhere')}</p>
            <p className="mt-2 text-sm text-muted">
              {rich('account.toUndo', {
                keep: <strong>{t('account.keepMyAccount')}</strong>,
                date: date(deletion.erasesAt),
              })}
            </p>
            <Link
              href="/sign-in"
              data-testid="deletion-signin"
              className="mt-3 inline-block rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-sunk"
            >
              {t('account.signInAgain')}
            </Link>
          </>
        ) : deletion?.requestedAt ? (
          <>
            <p className="mt-2 text-sm">
              {rich('account.willErase', { date: <strong>{date(deletion.erasesAt)}</strong> })}
            </p>
            <p className="mt-2 text-sm text-muted">{t('account.changeMind')}</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void keepAccount()}
              data-testid="cancel-deletion"
              className="mt-3 w-full rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-sunk disabled:opacity-50 sm:w-auto"
            >
              {busy ? t('account.cancelling') : t('account.keepMyAccount')}
            </button>
          </>
        ) : deleting ? (
          <div className="mt-3 rounded-md border border-line p-3 text-sm">
            <p>
              {t('account.deleteWarning')} <strong>{t('account.cannotUndo')}</strong>{' '}
              {t('account.exportFirst')}
            </p>
            <p className="mt-2 text-muted">
              {t('account.graceNote', { days: deletion?.graceDays ?? 7 })}
            </p>
            <label htmlFor="confirm-email" className="mt-3 block text-xs text-muted">
              {t('account.typeEmail')}
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
                {busy ? t('account.scheduling') : t('account.deleteMyAccount')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDeleting(false);
                  setConfirmEmail('');
                }}
                className="rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-sunk"
              >
                {t('common.neverMind')}
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="mt-2 text-sm text-muted">
              {t('account.erasesSummary', { days: deletion?.graceDays ?? 7 })}
            </p>
            <button
              type="button"
              onClick={() => setDeleting(true)}
              data-testid="delete-account"
              className="mt-3 w-full rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-semibold text-danger transition-colors hover:bg-sunk sm:w-auto"
            >
              {t('account.deleteAccount')}
            </button>
          </>
        )}
      </section>

      <p className="mt-6 text-xs text-muted">
        <Link href="/app/settings" className="underline">
          {t('common.settings')}
        </Link>{' '}
        ·{' '}
        <Link href="/privacy" className="underline">
          {t('common.privacy')}
        </Link>{' '}
        ·{' '}
        <Link href="/pricing" className="underline">
          {t('common.pricing')}
        </Link>
      </p>
    </main>
  );
}
