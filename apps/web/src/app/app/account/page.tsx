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
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
  }, []);

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
      <h1 className="mt-2 font-serif text-2xl">Account</h1>

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
        className="mt-6 rounded-lg border border-line bg-surface p-4"
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
                  className="rounded-md border border-line px-4 py-2 text-sm"
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
              className="mt-3 w-full rounded-md border border-line px-4 py-2 text-sm sm:w-auto"
            >
              Cancel subscription
            </button>
          )
        ) : null}
      </section>

      {billing && (billing.plan === 'FREE_TRIAL' || billing.cancelAtPeriodEnd) ? (
        <section className="mt-6">
          <h2 className="font-serif text-lg">Plans</h2>
          {billing.unavailableReason ? (
            <p className="mt-2 text-sm text-muted">
              {billing.unavailableReason} During the pilot your allowances are set by hand — email
              us and we will move you.
            </p>
          ) : null}
          <ul className="mt-3 space-y-3">
            {billing.plans.map((plan) => (
              <li key={plan.plan} className="rounded-lg border border-line bg-surface p-4">
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
                  className="mt-3 w-full rounded-md bg-ink px-4 py-2 text-sm text-paper disabled:opacity-50 sm:w-auto"
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

      <section className="mt-6 rounded-lg border border-line bg-surface p-4">
        <h2 className="text-sm font-medium">This month</h2>
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
                        className={`block h-full ${a.remaining === 0 ? 'bg-warn' : 'bg-ink'}`}
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
        <section className="mt-6 rounded-lg border border-line bg-surface p-4">
          <h2 className="text-sm font-medium">Invoices</h2>
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
