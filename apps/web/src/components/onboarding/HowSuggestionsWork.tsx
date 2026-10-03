'use client';

/**
 * "How suggestions work" — PRD §2.2, §5.4, §6.4, PHASES 5.3.
 *
 *   "a 90-second 'how suggestions work' panel (keys, Assist vs Draft, 'verify every citation')."
 *
 * The copy is the product's honest description of itself: what the model sees, what it may cite,
 * that nothing enters the chapter without a keystroke, and that a citation is a pointer to a
 * passage the student still has to read. It is the same message the empty states and the
 * provenance marks carry, said once in full.
 */

import { useEffect, useRef } from 'react';
import { WritingProfile } from './WritingProfile';

export function HowSuggestionsWork({
  open,
  onClose,
  documentId,
}: {
  open: boolean;
  onClose: () => void;
  /** Opened from a thesis: also show what the AI has learned about the student's writing. */
  documentId?: string;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-ink/30 p-6 pt-16">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="how-title"
        data-testid="how-suggestions-work"
        className="max-h-[80vh] w-full max-w-xl overflow-y-auto rounded-md border border-line bg-surface p-6 text-sm shadow-lg"
      >
        <div className="flex items-baseline justify-between">
          <h2 id="how-title" className="text-lg font-bold">
            How suggestions work
          </h2>
          <button
            ref={closeRef}
            type="button"
            className="text-xs text-muted underline"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <p className="mt-1 text-xs text-muted">About ninety seconds to read.</p>

        <h3 className="mt-5 font-medium">The keys</h3>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="font-mono text-xs">Ctrl+/</dt>
          <dd>Ask for a suggestion at the cursor. It appears in grey.</dd>
          <dt className="font-mono text-xs">Tab</dt>
          <dd>Accept it. Nothing enters the chapter until you press this.</dd>
          <dt className="font-mono text-xs">Alt+→</dt>
          <dd>Accept one word at a time.</dd>
          <dt className="font-mono text-xs">Shift+→</dt>
          <dd>Guide it first: say what the next sentence should do.</dd>
          <dt className="font-mono text-xs">Esc</dt>
          <dd>
            Dismiss. Dismissing still counts against the month, because the text was generated.
          </dd>
          <dt className="font-mono text-xs">Ctrl+Shift+D</dt>
          <dd>Draft a whole section from your library.</dd>
        </dl>

        <h3 className="mt-5 font-medium">Assist and Draft are different things</h3>
        <p className="mt-2">
          <strong>Assist</strong> writes the next sentence or two in your voice, from what is around
          the cursor and the passages of your library that match it — or only of the sources you
          pinned, if you pinned some. It is quick and you use it often.
        </p>
        <p className="mt-2">
          <strong>Draft</strong> writes a first pass at a section from your outline and your
          library. It arrives tinted, as a block you read and then accept or discard as a whole. It
          uses the stronger model, so the monthly allowance is small.
        </p>
        <p className="mt-2">
          Both only see what you have given them: this chapter, your outline and glossary, and the
          papers in your library. They cannot cite a paper that is not in your library, and if they
          try, the citation is removed before you see it.
        </p>

        {documentId ? (
          <>
            <h3 className="mt-5 font-medium">What it has learned about your writing</h3>
            <p className="mt-2">
              Suggestions follow your style, learned from what you wrote yourself, and anything you
              add here.
            </p>
            <WritingProfile documentId={documentId} />
          </>
        ) : null}

        <h3 className="mt-5 font-medium">Verify every citation</h3>
        <p className="mt-2">
          A citation is a pointer to a passage, not proof. Hover it to read the passage it stands
          on; open the PDF at that page before you keep the sentence. If the passage does not say
          what the sentence claims, delete the citation or the sentence. Your examiner will check;
          do it first.
        </p>

        <h3 className="mt-5 font-medium">What is recorded</h3>
        <p className="mt-2">
          Every accepted suggestion is marked with where it came from, and the AI-usage log you can
          export lists each one. Text you type yourself is yours and is marked as such.
        </p>
      </section>
    </div>
  );
}
