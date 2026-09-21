'use client';

/**
 * "Your examiner will ask about this" (2026-09-21).
 *
 * Shows how much of what the thesis cites has actually been read, using the `groundingLevel` the
 * indexer already records per source. The server does the judging (`reading-depth.ts`); this shows
 * the sentence and the sources behind it.
 *
 * Two design choices, both about not being annoying:
 *
 * - **It is silent when there is nothing to say.** No badge, no zero-state, no green tick begging
 *   to be noticed. A tool that always has a warning is a tool people learn to scroll past.
 * - **It never blocks anything.** No export refusal, no gate. This is what a good supervisor
 *   would tell you, given three months earlier than they would have.
 */

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

type SourceDepth = {
  sourceId: string;
  shortRef: string;
  title: string | null;
  groundingLevel: 'NONE' | 'ABSTRACT' | 'FULL_TEXT';
  citeCount: number;
};

type Depth = {
  totals: { sources: number; cited: number; fullText: number; abstract: number; none: number };
  atRisk: SourceDepth[];
  unread: SourceDepth[];
  headline: string | null;
};

export function ReadingDepth({ documentId }: { documentId: string }) {
  const [depth, setDepth] = useState<Depth | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<Depth>(`/documents/${documentId}/citations/reading-depth`)
      .then((d) => {
        if (!cancelled) setDepth(d);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  if (!depth?.headline) return null;

  const flagged = [...depth.unread, ...depth.atRisk];
  // A thesis whose cited sources have all been read gets one quiet line, not a panel.
  const worthOpening = flagged.length > 0;

  return (
    <section
      data-testid="reading-depth"
      className={`mt-4 rounded-md border p-2 ${
        worthOpening ? 'border-warn/40 bg-warn-soft' : 'border-line bg-surface'
      }`}
    >
      <p className="eyebrow">How much of this have you read?</p>
      <p className="mt-1 text-xs text-ink">{depth.headline}</p>

      <p className="mt-1.5 text-xs text-muted">
        {depth.totals.fullText} read in full · {depth.totals.abstract} abstract only
        {depth.totals.none > 0 ? ` · ${depth.totals.none} nothing fetched` : ''}
      </p>

      {worthOpening ? (
        <>
          <button
            type="button"
            data-testid="reading-depth-toggle"
            onClick={() => setOpen((v) => !v)}
            className="mt-1.5 text-xs underline"
          >
            {open ? 'Hide' : `Show the ${flagged.length}`}
          </button>
          {open ? (
            <ul className="mt-2 grid list-none gap-1 p-0">
              {flagged.map((source) => (
                <li key={source.sourceId} className="text-xs">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-ink">{source.title ?? source.shortRef}</span>
                    <span className="shrink-0 tnum text-muted">×{source.citeCount}</span>
                  </span>
                  <span className="text-muted">
                    {source.shortRef} ·{' '}
                    {source.groundingLevel === 'NONE'
                      ? 'nothing fetched — not even an abstract'
                      : 'abstract only'}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-2 text-xs text-faint">
            Upload the PDF in Sources to read one properly. Nothing here stops you exporting.
          </p>
        </>
      ) : null}
    </section>
  );
}
