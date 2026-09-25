/**
 * `/pricing` — PRD §11.6, §11.3, §12.3, §2.5, PHASES v2 W11.3.
 *
 * A server component: the prices and caps come from `packages/config`, which is the same table the
 * charge and the cap check read, so this page cannot drift from what actually happens.
 */

import { METERED_ACTIONS, PLAN_LIMITS, PRICING } from '@tc/config';
import Link from 'next/link';

export const metadata = {
  title: 'Pricing — Thesis Copilot',
  description: 'One student plan, cancel any time, and what every allowance actually means.',
};

const ACTION_LABEL: Record<string, string> = {
  ASSIST: 'Assist suggestions (a sentence or two, at the cursor)',
  DRAFT: 'Draft sections (a first pass at a whole section)',
  CITE: 'Citation suggestions',
  CHAT: 'Questions to your library',
  COMMAND: 'Section commands (expand, formalise, shorten…)',
  COHERENCE: 'Coherence checks across chapters',
};

const PLANS = ['FREE_TRIAL', 'STUDENT_MONTHLY', 'STUDENT_ANNUAL'] as const;

const PLAN_LABEL: Record<string, string> = {
  FREE_TRIAL: 'Free trial',
  STUDENT_MONTHLY: 'Student, monthly',
  STUDENT_ANNUAL: 'Student, annual',
};

export default function PricingPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <nav className="text-xs text-muted">
        <Link href="/" className="hover:underline">
          Thesis Copilot
        </Link>{' '}
        / Pricing
      </nav>
      <h1 className="mt-2 text-balance font-serif text-[30px] font-semibold leading-tight text-ink">
        Pricing
      </h1>
      <p className="mt-3 max-w-xl text-muted">
        One plan, priced for a student. Everything is included; what differs is how much AI you can
        use in a month. Cancel in one click, from any device.
      </p>

      <section className="mt-8 grid gap-4 sm:grid-cols-3">
        {PLANS.map((plan) => (
          <div key={plan} className="rounded-md border border-line bg-surface p-4">
            <p className="font-medium">{PLAN_LABEL[plan]}</p>
            <p className="mt-1 text-2xl">
              ₹{PRICING[plan].priceInr}
              <span className="text-xs text-muted">
                {plan === 'FREE_TRIAL'
                  ? ''
                  : PRICING[plan].period === 'yearly'
                    ? ' / year'
                    : ' / month'}
              </span>
            </p>
            <p className="mt-2 text-sm text-muted">{PRICING[plan].blurb}</p>
          </div>
        ))}
      </section>

      <h2 className="mt-10 text-balance font-serif text-[21px] font-semibold leading-snug text-ink">
        What you can do each month
      </h2>
      <p className="mt-1 text-sm text-muted">
        These are the real limits the software enforces, not marketing numbers. An action counts
        when the AI generates something, whether you keep it or throw it away.
      </p>
      <div className="mt-4 overflow-x-auto rounded-md border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="px-3 py-2">Each month</th>
              {PLANS.map((plan) => (
                <th key={plan} className="px-3 py-2">
                  {PLAN_LABEL[plan]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {METERED_ACTIONS.map((action) => (
              <tr key={action} className="border-t border-line">
                <td className="px-3 py-2">{ACTION_LABEL[action] ?? action}</td>
                {PLANS.map((plan) => (
                  <td key={plan} className="px-3 py-2">
                    {PLAN_LIMITS[plan].caps[action] || '—'}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="border-t border-line">
              <td className="px-3 py-2">Papers you can upload as the starting point</td>
              {PLANS.map((plan) => (
                <td key={plan} className="px-3 py-2">
                  {PLAN_LIMITS[plan].seedPapers}
                </td>
              ))}
            </tr>
            <tr className="border-t border-line">
              <td className="px-3 py-2">PDFs in your library</td>
              {PLANS.map((plan) => (
                <td key={plan} className="px-3 py-2">
                  {PLAN_LIMITS[plan].libraryPdfs}
                </td>
              ))}
            </tr>
            <tr className="border-t border-line">
              <td className="px-3 py-2">Export</td>
              {PLANS.map((plan) => (
                <td key={plan} className="px-3 py-2">
                  {PLAN_LIMITS[plan].export === 'FULL' ? 'Full, with bibliography' : 'Body only'}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <h2 className="mt-10 text-balance font-serif text-[21px] font-semibold leading-snug text-ink">
        Where we stand on integrity
      </h2>
      <p className="mt-2">No “humanise” feature. No detector evasion. Ever, at any price.</p>
      <p className="mt-2 text-muted">
        Every sentence the AI wrote is marked as such in your document, and you can export a log of
        exactly what it did and when — so you can disclose it to your department instead of hoping
        nobody asks. Every citation points at a real record and, where we have the paper, at the
        passage it stands on. The model is never given the chance to invent one: it can only cite
        what was retrieved and put in front of it.
      </p>

      <h2 className="mt-10 text-balance font-serif text-[21px] font-semibold leading-snug text-ink">
        Questions people actually ask
      </h2>
      <dl className="mt-3 space-y-4">
        <div>
          <dt className="font-medium">How is this different from Jenni?</dt>
          <dd className="mt-1 text-muted">
            Three things. Its citations come from a library you curated, and it cannot cite outside
            it. It knows your whole thesis — outline, glossary, the way you write — not just the
            paragraph above the cursor. And it is built for submission: your university&rsquo;s
            format, a real bibliography, a coherence check across chapters. Also: you can cancel
            here in one click, on a phone.
          </dd>
        </div>
        <div>
          <dt className="font-medium">Will my supervisor be able to tell I used AI?</dt>
          <dd className="mt-1 text-muted">
            You should tell them. The AI-usage log exists for exactly that. We will not help you
            hide it.
          </dd>
        </div>
        <div>
          <dt className="font-medium">What happens when I run out of an allowance?</dt>
          <dd className="mt-1 text-muted">
            That action stops until the 1st of the next month. Nothing else changes — you keep
            writing, your documents are untouched, and the screen tells you when it resets.
          </dd>
        </div>
        <div>
          <dt className="font-medium">What if I cancel?</dt>
          <dd className="mt-1 text-muted">
            You keep the plan you paid for until its period ends, then move to the free allowances.
            Your theses, sources and exports stay. Nothing is deleted.{' '}
            <Link href="/refunds" className="underline">
              Refund policy
            </Link>
            ,{' '}
            <Link href="/terms" className="underline">
              terms
            </Link>
            .
          </dd>
        </div>
        <div>
          <dt className="font-medium">Do you train on my thesis?</dt>
          <dd className="mt-1 text-muted">
            No.{' '}
            <Link href="/privacy" className="underline">
              What we do with your text
            </Link>
            .
          </dd>
        </div>
      </dl>

      <p className="mt-10">
        <Link
          href="/sign-in"
          className="rounded-md px-4 py-2 bg-accent text-accent-ink hover:bg-accent-hover font-semibold transition-colors"
        >
          Start the free trial
        </Link>
      </p>
    </main>
  );
}
