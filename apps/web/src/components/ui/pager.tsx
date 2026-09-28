'use client';

/**
 * Previous / "51–100 of 234" / Next, for a list the server sends a page at a time (2026-09-28).
 * Offset-based: the admin and institution lists are sorted and small enough per page that a
 * row shifting by one between clicks costs nothing, and "page 3 of 5" is what an admin expects.
 */

import { Button } from '@/components/ui/button';

export function Pager({
  offset,
  limit,
  total,
  onChange,
  noun,
}: {
  offset: number;
  limit: number;
  total: number;
  onChange: (offset: number) => void;
  /** Plural, for the count: "students". */
  noun: string;
}) {
  if (total <= limit && offset === 0) return null;
  const first = total === 0 ? 0 : offset + 1;
  const last = Math.min(offset + limit, total);
  return (
    <nav className="mt-3 flex items-center justify-between gap-3 text-xs" aria-label="Pages">
      <span className="tnum text-muted">
        {first}–{last} of {total} {noun}
      </span>
      <span className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={offset === 0}
          onClick={() => onChange(Math.max(0, offset - limit))}
          data-testid="pager-prev"
        >
          Previous
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={last >= total}
          onClick={() => onChange(offset + limit)}
          data-testid="pager-next"
        >
          Next
        </Button>
      </span>
    </nav>
  );
}
