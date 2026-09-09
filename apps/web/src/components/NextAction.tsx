'use client';

/**
 * "What should I do next?" for one thesis.
 *
 * The one screen a student opens most often is a chapter list, and the hardest part of the next
 * hour is deciding where to start. This says it in a sentence, with the number that makes it an
 * argument rather than a nag.
 *
 * It renders nothing at all while loading and nothing if the request fails. A recommendation is
 * help, not information the page owes anyone — a spinner or an error box where advice should be is
 * worse than the advice simply not appearing.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';

type NextActionKind =
  | 'outline'
  | 'sources'
  | 'unresolved'
  | 'comments'
  | 'flags'
  | 'write-ready'
  | 'grounding'
  | 'thinnest'
  | 'clear';

type NextAction = {
  kind: NextActionKind;
  headline: string;
  detail: string;
  cta: string;
  href: string;
};

/**
 * Only two tones, and most rungs get neither.
 *
 * `warn` is for the two cases where someone else is waiting or the thesis contradicts itself.
 * Everything else is ordinary advice and takes the plain surface — colouring all nine would make
 * the two that matter indistinguishable from the seven that do not.
 */
const NEEDS_ATTENTION: ReadonlySet<NextActionKind> = new Set(['comments', 'flags']);

export function NextAction({
  documentId,
  className,
  compact = false,
}: {
  documentId: string;
  className?: string;
  compact?: boolean;
}) {
  const [action, setAction] = useState<NextAction | null>(null);

  useEffect(() => {
    let live = true;
    api<NextAction>(`/documents/${documentId}/next-action`)
      .then((next) => {
        if (live) setAction(next);
      })
      .catch(() => {
        // Advice that cannot be fetched is simply not shown.
      });
    return () => {
      live = false;
    };
  }, [documentId]);

  if (!action) return null;

  const attention = NEEDS_ATTENTION.has(action.kind);
  const href = `/app/d/${documentId}${action.href}`;

  if (compact) {
    return (
      <Link
        href={href}
        className={cn(
          'group flex items-baseline gap-2 text-[12.5px] transition-colors',
          attention ? 'text-warn' : 'text-muted hover:text-accent',
          className,
        )}
      >
        <span className="truncate">{action.headline}</span>
        <span className="shrink-0 font-semibold underline-offset-2 group-hover:underline">
          {action.cta}
        </span>
      </Link>
    );
  }

  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-x-6 gap-y-3 rounded-md border px-4 py-3.5',
        attention ? 'border-warn/40 bg-warn-soft' : 'border-line bg-surface',
        className,
      )}
    >
      <div className="min-w-0 max-w-[62ch]">
        <p className="eyebrow">Next</p>
        <p
          className={cn(
            'mt-1 text-balance font-serif text-[16px] font-semibold leading-snug',
            attention ? 'text-warn' : 'text-ink',
          )}
        >
          {action.headline}
        </p>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">{action.detail}</p>
      </div>
      <Button asChild variant={attention ? 'primary' : 'secondary'} size="sm" className="shrink-0">
        <Link href={href}>{action.cta}</Link>
      </Button>
    </div>
  );
}
