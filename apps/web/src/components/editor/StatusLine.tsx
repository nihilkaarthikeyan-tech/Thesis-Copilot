'use client';

/**
 * One slim line above the text (ADR-0137, the calm editor the owner approved on 2026-10-09).
 *
 * Before it, three boxes stood between the toolbar and the first word: what the chapter is for
 * (the section guide), the four-step first-session guide and the library-filling progress line.
 * Now one line says the same in a few words — "15 papers found · 9 ready to cite · chapters
 * planned" — and **Show** opens the same three, unchanged, underneath. They stay mounted while
 * folded: the library line asks for the waiting suggestion again when a paper is ready, and the
 * section guide lays planned headings into a blank chapter, whether or not anyone is looking.
 */

import { Library, LoaderCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { useT } from '@/i18n/react';
import { cn } from '@/lib/utils';
import type { LibraryProgress } from './LibraryFilling';
import type { PlanState } from './SectionGuide';

/** The line's words, from what the three parts below it have read. Exported for the unit test. */
export function statusParts(
  progress: LibraryProgress | null,
  plan: PlanState,
  step: string | null,
  t: ReturnType<typeof useT>['t'],
  /** ADR-0145: the setup card, folded into the line ("set up", or "set up 2 of 5"). */
  setup: string | null = null,
): string[] {
  const parts: string[] = [];
  if (progress) {
    if (progress.searching && progress.found === 0) parts.push(t('editor.line.searching'));
    else if (progress.found > 0 || progress.ready > 0) {
      parts.push(t('editor.line.found', { found: Math.max(progress.found, progress.ready) }));
      if (progress.reading > 0) parts.push(t('editor.line.reading', { reading: progress.reading }));
      parts.push(t('editor.line.ready', { ready: progress.ready }));
    }
  }
  if (plan === 'planned') parts.push(t('editor.line.planned'));
  else if (plan === 'planning') parts.push(t('editor.line.planning'));
  else if (plan === 'notPlanned') parts.push(t('editor.line.notPlanned'));
  if (setup) parts.push(setup);
  if (step) parts.push(t('editor.line.next', { step }));
  return parts;
}

export function StatusLine({
  progress,
  plan,
  step,
  setup = null,
  open,
  onToggle,
  children,
}: {
  progress: LibraryProgress | null;
  plan: PlanState;
  /** The first-session guide's current step, while it is showing. */
  step: string | null;
  /** ADR-0145: the folded setup card's part of the line. */
  setup?: string | null;
  open: boolean;
  onToggle: () => void;
  /** The details: the same section guide, first-session guide and library line as before. */
  children: ReactNode;
}) {
  const { t } = useT();
  const parts = statusParts(progress, plan, step, t, setup);
  const text = parts.length > 0 ? parts.join(' · ') : t('editor.line.empty');
  const busy =
    plan === 'planning' || (progress !== null && (progress.searching || progress.reading > 0));

  return (
    <section
      data-testid="status-line"
      aria-label={t('editor.line.label')}
      className="mx-auto mb-3 max-w-[72ch]"
    >
      <div className="flex min-w-0 items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] text-muted">
        {busy ? (
          <LoaderCircle
            aria-hidden="true"
            className="size-[14px] shrink-0 animate-spin text-accent motion-reduce:animate-none"
            strokeWidth={2}
          />
        ) : (
          <Library
            aria-hidden="true"
            className="size-[14px] shrink-0 text-accent"
            strokeWidth={2}
          />
        )}
        <span
          data-testid="status-line-text"
          role="status"
          aria-live="polite"
          title={text}
          className="min-w-0 flex-1 truncate"
        >
          {text}
        </span>
        <button
          type="button"
          data-testid="status-line-toggle"
          aria-expanded={open}
          aria-controls="status-line-details"
          onClick={onToggle}
          className="shrink-0 font-semibold text-accent hover:underline"
        >
          {open ? t('editor.line.hide') : t('editor.line.show')}
        </button>
      </div>
      <div
        id="status-line-details"
        data-testid="status-line-details"
        className={cn(open ? 'mt-3' : 'hidden')}
      >
        {children}
      </div>
    </section>
  );
}
