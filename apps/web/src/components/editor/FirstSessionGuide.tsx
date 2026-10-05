'use client';

/**
 * The next-step guide for a student's first session (ADR-0070, 2026-10-05).
 *
 * Feedback from the owner's manager: Jenni moves a new writer on, step after step; ours left them
 * on a screen wondering what to do. This is four steps in the order a first session actually
 * goes — write, take a suggestion, look at the papers found, plan the chapters — with the current
 * one lit and its one action beside it. Each step ticks itself off from what the student does;
 * nothing here calls a model or costs anything.
 *
 * It sits above the editor's first-run hint (which keeps the "how suggestions work" walkthrough),
 * is put away for good with "Hide", and goes on its own once all four are done.
 */

import type { Editor } from '@tiptap/core';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useT } from '@/i18n/react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { LIBRARY_CHANGED } from './SourcePins';

type Setup = { steps: Array<{ id: string; done: boolean; href: string }> };

/** Words before the opening counts as written: a sentence, not a stray word. */
const OPENING_WORDS = 12;

const key = (what: string, documentId: string) => `tc.guide.${what}.${documentId}`;

function read(k: string): boolean {
  try {
    return window.localStorage.getItem(k) === '1';
  } catch {
    return false;
  }
}

function write(k: string): void {
  try {
    window.localStorage.setItem(k, '1');
  } catch {
    // The guide simply forgets; it asks nothing it cannot work out again.
  }
}

/** Called by the editor when a suggestion is kept, so step 2 ticks itself. */
export function markSuggestionKept(documentId: string): void {
  write(key('kept', documentId));
  window.dispatchEvent(new Event(GUIDE_CHANGED));
}

/** Called when the student opens the library, so step 3 ticks itself. */
export function markSourcesSeen(documentId: string): void {
  write(key('sources', documentId));
  window.dispatchEvent(new Event(GUIDE_CHANGED));
}

const GUIDE_CHANGED = 'tc:guide-changed';

function countWords(editor: Editor): number {
  const text = editor.state.doc.textBetween(0, editor.state.doc.content.size, ' ', ' ');
  return text.split(/\s+/).filter(Boolean).length;
}

export function FirstSessionGuide({
  documentId,
  editor,
  onSuggest,
  onShowSources,
  onVisibleChange,
  className,
}: {
  documentId: string;
  editor: Editor | null;
  onSuggest: () => void;
  onShowSources: () => void;
  /** Whether the guide is on screen, so the editor can leave out the hint it replaces. */
  onVisibleChange?: (visible: boolean) => void;
  className?: string;
}) {
  const { t } = useT();
  const [hidden, setHidden] = useState(true);
  const [words, setWords] = useState(0);
  const [kept, setKept] = useState(false);
  const [seen, setSeen] = useState(false);
  const [plan, setPlan] = useState<{ done: boolean; href: string } | null>(null);

  useEffect(() => {
    setHidden(read(key('hidden', documentId)));
    const refresh = () => {
      setKept(read(key('kept', documentId)));
      setSeen(read(key('sources', documentId)));
    };
    refresh();
    window.addEventListener(GUIDE_CHANGED, refresh);
    return () => window.removeEventListener(GUIDE_CHANGED, refresh);
  }, [documentId]);

  useEffect(() => {
    let live = true;
    const load = () =>
      api<Setup>(`/documents/${documentId}/setup`)
        .then((setup) => {
          if (!live) return;
          const proposal = setup.steps.find((s) => s.id === 'proposal');
          const outline = setup.steps.find((s) => s.id === 'outline');
          // Planning is done once there is an outline; until there is a proposal, that is where
          // planning starts.
          if (outline?.done) setPlan({ done: true, href: outline.href });
          else if (proposal && !proposal.done) setPlan({ done: false, href: proposal.href });
          else if (outline) setPlan({ done: false, href: outline.href });
        })
        .catch(() => undefined);
    void load();
    window.addEventListener(LIBRARY_CHANGED, load);
    return () => {
      live = false;
      window.removeEventListener(LIBRARY_CHANGED, load);
    };
  }, [documentId]);

  useEffect(() => {
    if (!editor) return;
    const update = () => setWords(countWords(editor));
    update();
    editor.on('update', update);
    return () => {
      editor.off('update', update);
    };
  }, [editor]);

  const steps = [
    {
      id: 'write',
      label: t('guide.write'),
      detail: t('guide.writeDetail'),
      done: words >= OPENING_WORDS || kept,
      action: null as React.ReactNode,
    },
    {
      id: 'suggest',
      label: t('guide.suggest'),
      detail: t('guide.suggestDetail'),
      done: kept,
      action: (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onSuggest}
          className="rounded-md bg-accent px-2.5 py-1 text-[12px] font-semibold text-accent-ink hover:bg-accent-hover"
        >
          {t('editor.suggest')}
        </button>
      ),
    },
    {
      id: 'sources',
      label: t('guide.sources'),
      detail: t('guide.sourcesDetail'),
      done: seen,
      action: (
        <button
          type="button"
          onClick={() => {
            markSourcesSeen(documentId);
            onShowSources();
          }}
          className="rounded-md border border-line px-2.5 py-1 text-[12px] font-semibold text-ink hover:border-line-strong"
        >
          {t('guide.sourcesAction')}
        </button>
      ),
    },
    {
      id: 'plan',
      label: t('guide.plan'),
      detail: t('guide.planDetail'),
      done: plan?.done ?? false,
      action: plan ? (
        <Link
          href={plan.href}
          className="rounded-md border border-line px-2.5 py-1 text-[12px] font-semibold text-ink hover:border-line-strong"
        >
          {t('guide.planAction')}
        </Link>
      ) : null,
    },
  ];

  const current = steps.find((s) => !s.done) ?? null;
  const visible = !hidden && current !== null;
  useEffect(() => {
    onVisibleChange?.(visible);
  }, [visible, onVisibleChange]);
  if (!visible || !current) return null;

  return (
    <section
      data-testid="first-session-guide"
      aria-label={t('guide.title')}
      className={cn('rounded-md border border-line bg-surface px-4 py-3', className)}
    >
      <div className="flex items-center justify-between gap-3">
        <ol className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
          {steps.map((step, i) => (
            <li
              key={step.id}
              data-step={step.id}
              data-done={step.done ? 'true' : 'false'}
              aria-current={step === current ? 'step' : undefined}
              className={cn(
                'flex items-center gap-1.5',
                step === current ? 'font-semibold text-ink' : 'text-faint',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px]',
                  step.done
                    ? 'bg-accent text-accent-ink'
                    : step === current
                      ? 'border border-accent text-accent'
                      : 'border border-line',
                )}
              >
                {step.done ? '✓' : i + 1}
              </span>
              <span className={step.done ? 'line-through decoration-faint' : undefined}>
                {step.label}
              </span>
            </li>
          ))}
        </ol>
        <button
          type="button"
          className="shrink-0 text-xs text-muted underline"
          onClick={() => {
            write(key('hidden', documentId));
            setHidden(true);
          }}
        >
          {t('guide.hide')}
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-[13px] text-muted" data-testid="guide-detail">
          {current.detail}
        </p>
        {current.action}
      </div>
    </section>
  );
}
