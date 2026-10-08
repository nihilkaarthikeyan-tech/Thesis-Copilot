'use client';

/**
 * The limit message (R31, ADR-0122), drawn the same way on every screen that can be refused by a
 * monthly allowance, the end of the free trial, the ₹100 ceiling or the site's budget: what ran
 * out, how much was used of how much, when it comes back in the student's own calendar, and a
 * link to the usage table and plans (or the pricing page). The words are `lib/limit.ts`'s.
 *
 * It fits wherever it is put — a 288 px side panel, a 390 px phone — by wrapping, never by
 * growing: no fixed width, and a long word breaks rather than pushing the box out.
 */

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { type LimitRefusal, limitRefusal, limitText } from '@/lib/limit';
import { cn } from '@/lib/utils';

export function LimitNotice({
  limit,
  className,
  bare = false,
}: {
  limit: LimitRefusal | null;
  className?: string;
  /** Inside a frame of its own (the editor's message strip): no border or tint of its own. */
  bare?: boolean;
}) {
  if (!limit) return null;
  const text = limitText(limit);
  return (
    <div
      role="alert"
      data-testid="limit-notice"
      data-kind={limit.kind}
      className={cn(
        'min-w-0 max-w-full text-[12.5px] leading-snug text-ink [overflow-wrap:anywhere]',
        bare ? '' : 'rounded-md border border-warn/40 bg-warn-soft px-3 py-2',
        className,
      )}
    >
      <p className="font-semibold">{text.title}</p>
      <p className="mt-0.5">{text.body}</p>
      {text.link ? (
        <Link
          href={text.link.href}
          data-testid="limit-notice-link"
          className="mt-1 inline-block font-semibold text-accent underline underline-offset-2 hover:text-accent-hover"
        >
          {text.link.label}
        </Link>
      ) : null}
    </div>
  );
}

/**
 * A screen's hold on the last limit refusal. In a `catch`: `if (limit.take(error)) return;` — true
 * when the error was a limit (now shown), false for any other failure, which the screen handles as
 * before. `clear()` when the action is tried again.
 */
export function useLimit() {
  const [value, setValue] = useState<LimitRefusal | null>(null);
  const take = useCallback((error: unknown): boolean => {
    const found = limitRefusal(error);
    setValue(found);
    return found !== null;
  }, []);
  const clear = useCallback(() => setValue(null), []);
  return useMemo(() => ({ value, take, clear }), [value, take, clear]);
}
