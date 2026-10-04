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
import { useMemo, useState } from 'react';
import type { DescribeEquation } from './FormatToolbar';

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
  onReplace,
  describe,
}: {
  value: string;
  /** KaTeX's complaint about `value`, or null when it draws. */
  problem: string | null;
  display: boolean;
  onInsert: (latex: string) => void;
  /** Replaces the whole field — what an equation written from words does. */
  onReplace?: (latex: string) => void;
  /** ADR-0063: LaTeX from a description in words. Absent hides the box. */
  describe?: DescribeEquation;
}) {
  const [words, setWords] = useState('');
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<{ reading: string; refusal: string | null } | null>(null);

  async function fromWords() {
    if (!describe || !onReplace || !words.trim() || asking) return;
    setAsking(true);
    setAnswer(null);
    try {
      const result = await describe(words.trim(), value);
      if (result.ok) {
        onReplace(result.latex);
        setAnswer({ reading: result.reading, refusal: null });
      } else {
        setAnswer({ reading: result.reading, refusal: result.refusal });
      }
    } catch (error) {
      setAnswer({
        reading: '',
        refusal: error instanceof Error ? error.message : 'That did not work. Try again.',
      });
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="mt-2 space-y-2" data-testid="math-help">
      {describe && onReplace ? (
        <div data-testid="math-words" className="rounded-md border border-line bg-paper p-2">
          <label className="text-[11px] text-faint" htmlFor="math-words-field">
            Or describe it in words{value ? ' (to change the equation above)' : ''}
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id="math-words-field"
              value={words}
              maxLength={600}
              onChange={(e) => setWords(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  void fromWords();
                }
              }}
              placeholder="e.g. y equals beta zero plus beta one times x"
              className="min-w-0 flex-1 rounded-md border border-line px-2 py-1 text-sm"
            />
            <button
              type="button"
              disabled={asking || !words.trim()}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void fromWords()}
              className="shrink-0 rounded-md border border-line-strong bg-surface px-2 py-1 text-xs font-semibold text-ink hover:bg-sunk disabled:opacity-50"
            >
              {asking ? 'Writing…' : 'Write it'}
            </button>
          </div>
          {answer?.refusal ? (
            <p className="mt-1 text-xs text-warn" role="alert">
              {answer.refusal}
            </p>
          ) : answer ? (
            <p className="mt-1 text-xs text-muted" data-testid="math-words-reading">
              Read back: {answer.reading} — check the preview, then Apply.
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-faint">
              Uses one section command from your allowance. Nothing goes in until you press Apply.
            </p>
          )}
        </div>
      ) : null}
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
