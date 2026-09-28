/**
 * `/terms` — the terms of service (2026-09-25). A DRAFT for the owner to approve, in plain words.
 *
 * Needed before launch: a payment gateway's approval (Razorpay's) checks for terms, and a
 * subscription needs them. Every promise here is one the product already keeps — the prices and
 * trial come from the tables billing charges by, the reminder from `BILLING`, the deletion window
 * and the integrity position from the code. The company's own details come from `@/lib/company`.
 */

import { BILLING, PLAN_LIMITS, PRICING } from '@tc/config';
import Link from 'next/link';
import { COMPANY, operatorName } from '@/lib/company';

export const metadata = { title: 'Terms — Thesis Copilot' };

const H2 = 'mt-8 text-balance text-[17px] font-bold leading-snug text-ink';

export default function TermsPage() {
  const monthly = PRICING.STUDENT_MONTHLY.priceInr.toLocaleString('en-IN');
  const annual = PRICING.STUDENT_ANNUAL.priceInr.toLocaleString('en-IN');
  const trialDays = PLAN_LIMITS.FREE_TRIAL.trialDays ?? 14;
  const operator = operatorName();
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <nav className="text-xs text-muted">
        <Link href="/" className="hover:underline">
          Thesis Copilot
        </Link>{' '}
        / Terms
      </nav>
      <h1 className="mt-2 text-balance text-[30px] font-bold leading-tight tracking-[-0.02em] text-ink">
        Terms of service
      </h1>
      <p className="mt-4 text-muted">
        Thesis Copilot is run by {operator}. By creating an account you agree to these terms. They
        are written to be read; if anything here is unclear, ask us (
        <Link href="/contact" className="underline">
          contact
        </Link>
        ).
      </p>

      <h2 className={H2}>What Thesis Copilot is</h2>
      <p className="mt-2 text-muted">
        A writing tool for theses: an editor, a library of your sources, and AI assistance that
        suggests, drafts, checks and answers from those sources. You write your thesis. Nothing the
        AI produces enters your document until you accept it, and what it wrote stays marked as
        such.
      </p>

      <h2 className={H2}>Your account</h2>
      <p className="mt-2 text-muted">
        You sign in with a code we email you, so keep your email account secure — whoever can read
        it can sign in as you. One account is for one person; do not share it. You must be 18 or
        over, or have a parent&rsquo;s or guardian&rsquo;s permission.
      </p>

      <h2 className={H2}>The free trial, plans and payment</h2>
      <p className="mt-2 text-muted">
        A new account starts with a {trialDays}-day free trial, with smaller monthly allowances and
        no card needed. The paid plans are ₹{monthly} a month or ₹{annual} a year, paid through
        Razorpay. A plan renews automatically at the end of each period until you cancel; we email
        you {BILLING.reminderDaysBefore} days before every renewal. If a payment fails, you keep
        your plan for {BILLING.graceDays} days while it is retried, then move to the trial
        allowances — your documents are never deleted for a failed payment.
      </p>
      <p className="mt-2 text-muted">
        AI features have monthly allowances, shown in the app, which reset at 00:00 UTC on the 1st
        of each month. We may change prices or allowances for future periods; we will email you
        before a change affects a plan you pay for.
      </p>

      <h2 className={H2}>Cancelling and refunds</h2>
      <p className="mt-2 text-muted">
        Cancel any time from the{' '}
        <Link href="/app/account" className="underline">
          account page
        </Link>
        , on any device. You keep your plan until the end of the period you paid for. Refunds are
        described on{' '}
        <Link href="/refunds" className="underline">
          the refunds page
        </Link>
        .
      </p>

      <h2 className={H2}>Your work</h2>
      <p className="mt-2 text-muted">
        What you write and upload stays yours. We use it only to run the service for you — to store
        it, show it to the people you share it with, and send the parts an AI feature needs when you
        use one. We do not train AI models on it, and neither do the AI providers we use (see{' '}
        <Link href="/privacy" className="underline">
          privacy
        </Link>
        ). You are responsible for having the right to upload the papers and files you add.
      </p>

      <h2 className={H2}>Using AI honestly</h2>
      <p className="mt-2 text-muted">
        AI suggestions can be wrong, and a citation can be misread. Check what you accept: you are
        responsible for the thesis you submit, and for following your university&rsquo;s rules on AI
        use. The AI-usage log exists so you can disclose that use. We do not offer, and you may not
        use Thesis Copilot for, disguising AI-written text or evading AI detection.
      </p>

      <h2 className={H2}>What you may not do</h2>
      <p className="mt-2 text-muted">
        Break the law with it; try to get into accounts or data that are not yours; overload, attack
        or copy the service; resell access; or use it to harm others. We may suspend an account that
        does, and will tell you why.
      </p>

      <h2 className={H2}>Sharing</h2>
      <p className="mt-2 text-muted">
        When you share a document with a supervisor or a co-author, they can see that document, and
        a co-author can edit it. You can remove their access at any time.
      </p>

      <h2 className={H2}>Keeping it running</h2>
      <p className="mt-2 text-muted">
        We work to keep Thesis Copilot available and your work safe, with nightly backups, but we
        cannot promise it will never be interrupted. Export your thesis regularly — the Word, PDF
        and LaTeX files are yours to keep. We may change or retire features; we will not remove your
        ability to export your work.
      </p>

      <h2 className={H2}>Limits of our liability</h2>
      <p className="mt-2 text-muted">
        As far as the law allows, we are not liable for indirect losses — a grade, a missed
        deadline, lost opportunities — and our total liability to you is limited to what you paid us
        in the twelve months before the claim. Nothing here limits rights you have under Indian
        consumer law that cannot be limited.
      </p>

      <h2 className={H2}>Ending</h2>
      <p className="mt-2 text-muted">
        You can delete your account from the account page at any time; it is erased seven days
        later, and you can change your mind in between. We may close an account that breaks these
        terms, after telling you why.
      </p>

      <h2 className={H2}>Changes, and the law</h2>
      <p className="mt-2 text-muted">
        If we change these terms in a way that matters, we will email you before the change takes
        effect. These terms are governed by the laws of India
        {COMPANY.jurisdictionCity
          ? `, and the courts of ${COMPANY.jurisdictionCity} have jurisdiction`
          : ''}
        .
      </p>
    </main>
  );
}
