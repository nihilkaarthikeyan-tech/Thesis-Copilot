'use client';

/**
 * "Add a proposal" — ADR-0062 (ADR-0059 row 2).
 *
 * "Start writing now" makes a thesis with no proposal, and the proposal is what every later
 * suggestion reads. This keeps it one click away without standing in the way: it asks the same
 * question the setup checklist's first step does (`GET /documents/:id/setup`, the `proposal`
 * step), shows nothing while loading, on failure, or once a proposal exists, and in the editor
 * the student can put it away for this thesis ("Not now", remembered in this browser).
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

type Setup = { steps: Array<{ id: string; done: boolean; href: string }> };

const dismissKey = (documentId: string) => `tc.hint.add-proposal.${documentId}`;

function dismissed(documentId: string): boolean {
  try {
    return window.localStorage.getItem(dismissKey(documentId)) === '1';
  } catch {
    return false;
  }
}

export function AddProposalPrompt({
  documentId,
  variant,
  className = '',
}: {
  documentId: string;
  /** `list`: a short line on the thesis card. `editor`: a sentence above the chapter. */
  variant: 'list' | 'editor';
  className?: string;
}) {
  const [href, setHref] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (variant === 'editor' && dismissed(documentId)) {
      setHidden(true);
      return;
    }
    let cancelled = false;
    api<Setup>(`/documents/${documentId}/setup`)
      .then((setup) => {
        const step = setup.steps.find((s) => s.id === 'proposal');
        if (!cancelled && step && !step.done) setHref(step.href);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [documentId, variant]);

  if (!href || hidden) return null;

  if (variant === 'list') {
    return (
      <span className={className} data-testid="add-proposal">
        No proposal yet ·{' '}
        <Link href={href} className="text-accent hover:underline">
          Add a proposal
        </Link>
      </span>
    );
  }

  return (
    <div
      data-testid="add-proposal"
      className={`flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-md border border-line bg-surface px-4 py-2 text-[13px] text-muted ${className}`}
    >
      <p>
        This thesis has no proposal yet. It is optional, but suggestions stay closer to your topic
        once it has one.{' '}
        <Link href={href} className="font-semibold text-accent hover:underline">
          Add a proposal
        </Link>
      </p>
      <button
        type="button"
        className="shrink-0 text-xs underline"
        onClick={() => {
          try {
            window.localStorage.setItem(dismissKey(documentId), '1');
          } catch {
            // Shown again next time, which is harmless.
          }
          setHidden(true);
        }}
      >
        Not now
      </button>
    </div>
  );
}
