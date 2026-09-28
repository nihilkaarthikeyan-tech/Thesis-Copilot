/**
 * `/contact` — who runs Thesis Copilot and how to reach them (2026-09-25).
 *
 * Needed before launch: Razorpay's approval checks that a paying customer can reach the business,
 * and a student with a billing or account problem needs somewhere to write. The details come from
 * `@/lib/company`, which holds nothing invented.
 */

import Link from 'next/link';
import { COMPANY } from '@/lib/company';

export const metadata = { title: 'Contact — Thesis Copilot' };

const MISSING = 'To be added.';

export default function ContactPage() {
  const rows: Array<[string, string | null]> = [
    ['Email', COMPANY.supportEmail],
    ['Phone', COMPANY.phone],
    ['Operated by', COMPANY.legalName],
    ['Address', COMPANY.address],
  ];
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <nav className="text-xs text-muted">
        <Link href="/" className="hover:underline">
          Thesis Copilot
        </Link>{' '}
        / Contact
      </nav>
      <h1 className="mt-2 text-balance text-[30px] font-bold leading-tight tracking-[-0.02em] text-ink">
        Contact us
      </h1>
      <p className="mt-4 text-muted">
        Write to us about anything — a problem with your account, a charge you do not recognise, a
        question before you subscribe. Send it from the address you sign in with, so we can find
        your account.
      </p>

      <dl className="mt-6 grid gap-3 text-sm" data-testid="contact-details">
        {rows.map(([label, value]) => (
          <div key={label} className="grid gap-1 sm:grid-cols-[9rem_1fr]">
            <dt className="text-faint">{label}</dt>
            <dd className="text-ink">
              {value === null ? (
                <span className="text-muted">{MISSING}</span>
              ) : label === 'Email' ? (
                <a href={`mailto:${value}`} className="underline">
                  {value}
                </a>
              ) : (
                <span className="whitespace-pre-line">{value}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>

      <h2 className="mt-8 text-balance text-[17px] font-bold leading-snug text-ink">
        Quicker than writing
      </h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
        <li>
          Cancel a subscription, or delete your account: the{' '}
          <Link href="/app/account" className="underline">
            account page
          </Link>
          , on any device.
        </li>
        <li>
          Refunds:{' '}
          <Link href="/refunds" className="underline">
            how they work
          </Link>
          .
        </li>
        <li>
          What happens to your text:{' '}
          <Link href="/privacy" className="underline">
            privacy
          </Link>
          .
        </li>
      </ul>
    </main>
  );
}
