/**
 * `/refunds` — PRD §2.5, PHASES v2 W11.2.
 *
 * §2.5: "clear refund policy on the pricing page". Linked from pricing, the account screen and
 * every cancellation email, because a policy nobody can find is the complaint we are avoiding.
 */

import Link from 'next/link';

export const metadata = { title: 'Refunds — Thesis Copilot' };

export default function RefundsPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <nav className="text-xs text-muted">
        <Link href="/pricing" className="hover:underline">
          Pricing
        </Link>{' '}
        / Refunds
      </nav>
      <h1 className="mt-2 text-balance font-serif text-[30px] font-semibold leading-tight text-ink">
        Refunds
      </h1>

      <h2 className="mt-8 text-balance font-serif text-[17px] font-semibold leading-snug text-ink">
        Cancelling
      </h2>
      <p className="mt-2 text-muted">
        Open Account and press Cancel. One click, on any device, at any time. Your subscription
        stops renewing; you keep everything you have paid for until that period ends. We email you a
        confirmation, and we email you three days before every renewal so a charge never surprises
        you.
      </p>

      <h2 className="mt-8 text-balance font-serif text-[17px] font-semibold leading-snug text-ink">
        Refunds we give without argument
      </h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
        <li>You were charged after cancelling.</li>
        <li>You were charged twice for the same period.</li>
        <li>
          You were charged for a renewal you did not want and tell us within 7 days, having used
          fewer than a tenth of that period&rsquo;s allowances.
        </li>
        <li>The service was unusable for more than 48 hours in a period, for reasons our end.</li>
      </ul>

      <h2 className="mt-8 text-balance font-serif text-[17px] font-semibold leading-snug text-ink">
        Refunds we do not give
      </h2>
      <p className="mt-2 text-muted">
        A period you used. If you have drafted with it, cited with it and exported from it, the cost
        was real on our side too — the AI calls are paid per token. Cancel instead, and the next
        period is never charged.
      </p>

      <h2 className="mt-8 text-balance font-serif text-[17px] font-semibold leading-snug text-ink">
        How
      </h2>
      <p className="mt-2 text-muted">
        Email us from the address on your account and say what happened. We reply within two working
        days. Approved refunds go back to the card or UPI account that paid, through Razorpay, and
        take 5–7 working days to appear.
      </p>
    </main>
  );
}
