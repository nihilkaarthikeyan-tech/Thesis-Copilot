'use client';

/**
 * Usage one click away (Jenni build plan R12, ADR-0099): a button that opens a bar for each
 * monthly allowance — green, then amber, then red as it fills — the date they renew, and a link
 * to the Account page. Before this the bars were a page away (Account) and the editor showed two
 * numbers. Free: `GET /usage/me`, read when the menu opens, so it is never stale.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { allowanceName, includedAllowances, notIncluded } from '@/lib/action-names';
import { api } from '@/lib/api';
import { barTone } from '@/lib/usage';

type Usage = {
  resetsAt: string;
  trial?: { ended: boolean; endsAt?: string | null } | null;
  actions: Array<{ action: string; used: number; cap: number; remaining: number }>;
};

const TONE_CLASS: Record<ReturnType<typeof barTone>, string> = {
  ok: 'bg-ok',
  low: 'bg-amber-500',
  out: 'bg-warn',
};

export function UsageMenu(props: {
  /** What the button shows: a word, or the editor's own counter. */
  label: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setFailed(false);
    api<Usage>('/usage/me')
      .then(setUsage)
      .catch(() => setFailed(true));
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const lines = usage ? includedAllowances(usage.actions) : [];
  const missing = usage ? notIncluded(usage.actions) : '';

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        className={props.className}
        data-testid={props.testId ?? 'usage-menu'}
      >
        {props.label}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Your usage this month"
          className="absolute top-full right-0 z-50 mt-1 w-72 rounded-md border border-line bg-surface p-3 text-left text-[12.5px] text-ink shadow-lg"
          data-testid="usage-panel"
        >
          <p className="font-semibold">This month</p>
          {failed ? (
            <p className="mt-2 text-muted">Your usage could not be read. Try again in a moment.</p>
          ) : !usage ? (
            <p className="mt-2 text-muted">Reading…</p>
          ) : (
            <>
              {usage.trial?.ended ? (
                <p className="mt-1 text-warn">
                  Your free trial has ended; your theses stay, and AI help needs a plan.
                </p>
              ) : null}
              <ul className="mt-2 grid list-none gap-2 p-0">
                {lines.map((line) => {
                  const tone = barTone(line.used, line.cap);
                  const share = line.cap > 0 ? Math.min(1, line.used / line.cap) : 1;
                  return (
                    <li key={line.action} data-testid={`usage-line-${line.action}`}>
                      <span className="flex justify-between gap-2">
                        <span>{allowanceName(line.action)}</span>
                        <span className="tnum text-muted">
                          {line.used} / {line.cap}
                        </span>
                      </span>
                      <span
                        className="mt-0.5 block h-1.5 overflow-hidden rounded-full bg-sunk"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={line.cap}
                        aria-valuenow={line.used}
                        aria-label={allowanceName(line.action)}
                      >
                        <span
                          className={`block h-full rounded-full ${TONE_CLASS[tone]}`}
                          style={{ width: `${Math.round(share * 100)}%` }}
                          data-tone={tone}
                        />
                      </span>
                    </li>
                  );
                })}
              </ul>
              {missing ? (
                <p className="mt-2 text-[11.5px] text-muted">Not in your plan: {missing}.</p>
              ) : null}
              <p className="mt-2 text-[11.5px] text-muted">
                Renews{' '}
                {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
                  new Date(usage.resetsAt),
                )}
                .{' '}
                <Link href="/app/account" className="underline">
                  Account and plans
                </Link>
              </p>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * R12 on the screens without a header of their own (the outline, sources, proposal, submit, viva
 * and the rest draw only a breadcrumb line): the same menu, top right. The theses list and the
 * editor carry it in their headers, and the Account page shows the full table, so it stays off
 * those.
 */
export function UsageCorner() {
  const pathname = usePathname() ?? '';
  const own =
    pathname === '/app' || pathname.includes('/write/') || pathname.startsWith('/app/account');
  if (own) return null;
  return (
    <div className="fixed top-2 right-3 z-40 print:hidden" data-testid="usage-corner">
      <UsageMenu
        label="Usage"
        className="rounded-md border border-line bg-surface px-2.5 py-1 text-[12px] font-semibold text-muted shadow-sm hover:text-ink"
      />
    </div>
  );
}
