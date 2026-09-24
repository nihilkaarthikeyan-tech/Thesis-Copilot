'use client';

/**
 * Reference health — retracted, stale, duplicated or unverifiable sources (2026-09-21).
 *
 * The citation checks next door ask whether the text and the library agree. This asks whether the
 * library is worth agreeing with, which is a question a student stops asking about a reference
 * roughly the moment they add it — eighteen months before anybody reads the bibliography.
 *
 * Costs nothing to compute, so it loads with the panel rather than hiding behind a button.
 * Reports only: a duplicate that is obvious to a string comparison is occasionally two real
 * papers, and the student is the one who knows which.
 */

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

type Finding = {
  kind:
    | 'RETRACTED'
    | 'STALE_PREPRINT'
    | 'DUPLICATE'
    | 'UNRESOLVED'
    | 'NO_IDENTIFIER'
    | 'VENUE_CONCENTRATION';
  sourceId: string;
  shortRef: string;
  title: string | null;
  message: string;
  severity: 'high' | 'medium' | 'low';
};

type Health = { findings: Finding[]; headline: string | null; sources: number };

const KIND_LABEL: Record<Finding['kind'], string> = {
  RETRACTED: 'Retracted',
  STALE_PREPRINT: 'Preprint, now dated',
  DUPLICATE: 'Listed twice',
  UNRESOLVED: 'Could not verify',
  NO_IDENTIFIER: 'No DOI',
  VENUE_CONCENTRATION: 'One journal dominates',
};

const SEVERITY_TONE: Record<Finding['severity'], string> = {
  high: 'border-warn/50 bg-warn-soft',
  medium: 'border-line-strong bg-surface',
  low: 'border-line bg-surface',
};

export function ReferenceHealth({ documentId }: { documentId: string }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<Health>(`/documents/${documentId}/reference-health`)
      .then((h) => {
        if (!cancelled) setHealth(h);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  // Silent on a healthy bibliography — the same restraint the reading-depth warning uses.
  if (!health?.headline) return null;

  const high = health.findings.filter((f) => f.severity === 'high').length;

  return (
    <section
      data-testid="reference-health"
      className={`mt-4 rounded-md border p-2 ${high > 0 ? 'border-warn/40 bg-warn-soft' : 'border-line bg-surface'}`}
    >
      <p className="eyebrow">Your references</p>
      <p className="mt-1 text-xs text-ink">{health.headline}</p>

      <button
        type="button"
        data-testid="reference-health-toggle"
        onClick={() => setOpen((v) => !v)}
        className="mt-1.5 text-xs underline"
      >
        {open ? 'Hide' : `Show the ${health.findings.length}`}
      </button>

      {open ? (
        <ul className="mt-2 grid list-none gap-1.5 p-0" data-testid="reference-health-findings">
          {health.findings.map((finding) => (
            <li
              key={`${finding.kind}-${finding.sourceId}`}
              className={`rounded-md border p-2 text-xs ${SEVERITY_TONE[finding.severity]}`}
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-medium text-ink">{KIND_LABEL[finding.kind]}</span>
                <span className="shrink-0 text-muted">{finding.shortRef}</span>
              </span>
              {finding.title ? <p className="mt-0.5 truncate text-muted">{finding.title}</p> : null}
              <p className="mt-1 text-muted">{finding.message}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
