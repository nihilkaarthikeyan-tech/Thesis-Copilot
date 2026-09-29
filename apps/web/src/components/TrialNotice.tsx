'use client';

/**
 * Where a free trial stands, said before it matters (2026-09-29, ADR-0036).
 *
 * The trial ends 14 days after sign-up; after it, the theses stay and the AI features stop until
 * the student subscribes. A student should never learn that from a refused suggestion, so this is
 * shown for the whole trial (the owner, 2026-09-29: "show them clearly about the 14 day trial"):
 * the days left and the end date from the first day, louder in the last three, and after the end
 * what still works. Nothing is shown to a paying account, or to an account with no trial date
 * (the accounts that existed before the trial began to end).
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

type Trial = { endsAt: string; ended: boolean; daysLeft: number } | null;

/** From here the notice turns from information into a warning. */
const URGENT_DAYS = 3;

export function TrialNotice({ className }: { className?: string }) {
  const [trial, setTrial] = useState<Trial>(null);

  useEffect(() => {
    api<{ plan: string; trial: Trial }>('/usage/me')
      .then((u) => setTrial(u.plan === 'FREE_TRIAL' ? u.trial : null))
      .catch(() => undefined);
  }, []);

  if (!trial) return null;
  const urgent = trial.ended || trial.daysLeft <= URGENT_DAYS;

  const date = new Date(trial.endsAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
  });

  return (
    <div
      role="status"
      data-testid="trial-notice"
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3 text-[13.5px]',
        urgent
          ? 'border-warn/40 bg-warn-soft text-ink'
          : 'border-accent/30 bg-accent-soft text-ink',
        className,
      )}
    >
      <p className="min-w-0">
        {trial.ended ? (
          <>
            <strong>Your free trial ended on {date}.</strong> Your theses are safe and you can keep
            writing, editing and exporting. Subscribe to use the AI features again.
          </>
        ) : (
          <>
            <strong>
              {trial.daysLeft <= 1
                ? 'Your 14-day free trial ends today.'
                : trial.daysLeft <= 14
                  ? `Free trial: ${trial.daysLeft} of 14 days left.`
                  : `Free trial: ${trial.daysLeft} days left.`}
            </strong>{' '}
            It ends on {date}. After that your theses stay and you can keep writing; the AI features
            need a plan.
          </>
        )}
      </p>
      <Link
        href="/pricing"
        className="shrink-0 font-bold text-accent underline underline-offset-4 hover:text-accent-hover"
      >
        See plans
      </Link>
    </div>
  );
}
