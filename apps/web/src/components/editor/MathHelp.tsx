'use client';

/**
 * Help under the equation field (2026-10-04, JENNI-FIX-LIST item 22).
 *
 * The field asked for LaTeX with "E = mc^2" as its only hint, and the original complaint was
 * students who could not write a formula at all. Three things here, none of them a model call:
 * a row of examples to start from, a live picture of what the field will insert, and a cheat
 * sheet of the common patterns. Every pattern is one click and goes in at the field's caret, so a
 * formula can be built from pieces without knowing the syntax first.
 */

import { MATH_CHEAT_SHEET, MATH_EXAMPLES, type MathPattern } from '@tc/ui';
import katex from 'katex';
import { useMemo } from 'react';

/** KaTeX's drawing of `latex`; broken LaTeX comes out as KaTeX's own red source, never a throw. */
function Tex({ latex, display = false }: { latex: string; display?: boolean }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(latex, {
        displayMode: display,
        throwOnError: false,
        output: 'html',
      });
    } catch {
      return '';
    }
  }, [latex, display]);
  // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX output, from LaTeX typed in this field
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

function PatternButton({
  pattern,
  onInsert,
  testId,
  wide,
}: {
  pattern: MathPattern;
  onInsert: (latex: string) => void;
  testId: string;
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      title={`${pattern.label}: ${pattern.latex}`}
      aria-label={`Insert ${pattern.label.toLowerCase()}`}
      // Keeps the caret in the field, so the pattern goes where it was.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onInsert(pattern.latex)}
      className={
        wide
          ? 'flex min-w-0 items-center justify-between gap-2 rounded-md border border-line px-2 py-1.5 text-left text-xs text-ink transition-colors hover:bg-sunk'
          : 'inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-2 text-xs text-ink transition-colors hover:bg-sunk'
      }
    >
      {wide ? <span className="shrink-0 text-muted">{pattern.label}</span> : null}
      <span className="min-w-0 overflow-hidden text-[13px]">
        <Tex latex={pattern.latex} />
      </span>
    </button>
  );
}

export function MathHelp({
  value,
  problem,
  display,
  onInsert,
}: {
  value: string;
  /** KaTeX's complaint about `value`, or null when it draws. */
  problem: string | null;
  display: boolean;
  onInsert: (latex: string) => void;
}) {
  return (
    <div className="mt-2 space-y-2" data-testid="math-help">
      <div>
        <p className="text-[11px] text-faint">Start from an example</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {MATH_EXAMPLES.map((pattern) => (
            <PatternButton
              key={pattern.label}
              pattern={pattern}
              onInsert={onInsert}
              testId="math-example"
            />
          ))}
        </div>
      </div>

      {value && !problem ? (
        <div data-testid="math-preview" className="rounded-md bg-sunk px-3 py-2">
          <p className="text-[11px] text-faint">This is what will go in</p>
          <div className="mt-1 overflow-x-auto text-ink">
            <Tex latex={value} display={display} />
          </div>
        </div>
      ) : null}

      <p className="text-[11px] text-faint">
        Naming a compound in a sentence (H₂O, Al₂O₃, Fe³⁺)? Type it as ordinary text with the
        subscript and superscript buttons; an equation is for reactions and formulas.
      </p>

      <details className="group" data-testid="math-cheat-sheet">
        <summary className="cursor-pointer select-none text-xs font-medium text-accent">
          Cheat sheet
        </summary>
        <div className="mt-1 grid max-h-56 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
          {MATH_CHEAT_SHEET.map((pattern) => (
            <PatternButton
              key={pattern.label}
              pattern={pattern}
              onInsert={onInsert}
              testId="math-cheat"
              wide
            />
          ))}
        </div>
      </details>
    </div>
  );
}
