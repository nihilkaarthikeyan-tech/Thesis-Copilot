'use client';

/**
 * "3 of 5 set up" — the shape of the whole job, for somebody seeing it for the first time.
 *
 * `NextAction` already says what to do next and is better for a student who knows the product.
 * This answers the question a new user actually has, and only really once: *what is this, and how
 * far through am I?* A thesis tool has a five-stage arc that nobody arriving can see.
 *
 * ## It is built to be finished and then disappear
 *
 * A checklist that never completes is a permanent accusation. This one renders nothing once every
 * step is done — no row of ticks, no "well done", nothing. The reward for finishing is that the
 * thing goes away.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

type Step = {
  id: string;
  label: string;
  blurb: string;
  done: boolean;
  href: string;
};

type Progress = {
  steps: Step[];
  done: number;
  total: number;
  complete: boolean;
  next: Step | null;
};

export function SetupChecklist({ documentId }: { documentId: string }) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<Progress>(`/documents/${documentId}/setup`)
      .then((p) => {
        if (!cancelled) setProgress(p);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  // ADR-0071: while loading, hold the space the checklist will take. Rendering nothing and then
  // the panel pushed everything below it down, and a click meant for "Start another thesis"
  // opened another thesis's proposal (seen on production, 2026-10-05).
  if (!progress && !failed) {
    return <div aria-hidden="true" className="h-[118px]" data-testid="setup-checklist-pending" />;
  }
  // Nothing on failure, and nothing once it is finished. A checklist is help, not information
  // the page owes anyone.
  if (!progress || progress.complete) return null;

  return (
    <section data-testid="setup-checklist" className="rounded-md border border-line bg-surface p-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="eyebrow">Getting set up</p>
        <span className="tnum shrink-0 text-xs text-muted">
          {progress.done} of {progress.total}
        </span>
      </div>

      {/* A bar rather than a number alone: five steps is a short enough arc that seeing it is
          the point. */}
      <div
        className="mt-2 flex gap-1"
        role="progressbar"
        aria-valuenow={progress.done}
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-label="Setup progress"
      >
        {progress.steps.map((step) => (
          <span
            key={step.id}
            className={`h-1 flex-1 rounded-full ${step.done ? 'bg-ok' : 'bg-line'}`}
          />
        ))}
      </div>

      {progress.next ? (
        <p className="mt-2 text-sm text-ink">
          <Link href={progress.next.href} className="font-semibold underline">
            {progress.next.label}
          </Link>{' '}
          <span className="text-muted">— {progress.next.blurb}</span>
        </p>
      ) : null}

      <button
        type="button"
        data-testid="setup-toggle"
        onClick={() => setOpen((v) => !v)}
        className="mt-1.5 text-xs text-muted underline"
      >
        {open ? 'Hide the rest' : 'See all five steps'}
      </button>

      {open ? (
        <ol className="mt-2 grid list-none gap-1.5 p-0" data-testid="setup-steps">
          {progress.steps.map((step) => (
            <li key={step.id} className="flex items-baseline gap-2 text-xs">
              <span aria-hidden="true" className={step.done ? 'text-ok' : 'text-faint'}>
                {step.done ? '✓' : '○'}
              </span>
              <span className="min-w-0">
                <Link
                  href={step.href}
                  className={step.done ? 'text-muted line-through' : 'text-ink underline'}
                >
                  {step.label}
                </Link>
                {!step.done ? <span className="block text-muted">{step.blurb}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
