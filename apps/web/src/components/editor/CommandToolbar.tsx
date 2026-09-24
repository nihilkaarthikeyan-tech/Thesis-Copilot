'use client';

/**
 * Section commands — PRD FR-4.8, PHASES v2 W9.2.
 *
 *   "Result shown as a diff; apply or discard."
 *
 * A toolbar appears over a selection. The rewrite is shown as a word diff and enters the chapter
 * only on Apply, with provenance `COMMAND` — the same "flag, don't fix" rule as Assist and Draft.
 * Citation nodes inside the selection are checked: the API reports any the model dropped, and the
 * warning is shown before the student can apply it.
 */

import type { Editor } from '@tiptap/core';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';

type DiffOp = { type: 'same' | 'add' | 'remove'; text: string };

/** A key per op from its running character offset, so React never keys on the array index. */
function diffKeys(diff: DiffOp[]): Array<{ op: DiffOp; key: string }> {
  let offset = 0;
  return diff.map((op) => {
    const key = `${op.type}-${offset}`;
    offset += op.text.length;
    return { op, key };
  });
}

type RunResult = {
  command: string;
  text: string;
  diff: DiffOp[];
  words: number;
  originalWords: number;
  droppedCitations: string[];
  unchanged: boolean;
};

const COMMANDS = [
  { key: 'expand', label: 'Expand' },
  { key: 'formalise', label: 'Formalise' },
  { key: 'simplify', label: 'Simplify' },
  { key: 'shorten', label: 'Shorten' },
  { key: 'consistency', label: 'Check consistency' },
] as const;

export function CommandToolbar({
  editor,
  chapterId,
  onUsageChange,
  onNotice,
}: {
  editor: Editor | null;
  chapterId: string;
  onUsageChange: () => void;
  onNotice: (message: string) => void;
}) {
  const [selection, setSelection] = useState<{ from: number; to: number; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);

  // Track the selection so the toolbar knows what it would rewrite.
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const { from, to, empty } = editor.state.selection;
      if (empty) {
        setSelection(null);
        return;
      }
      const text = editor.state.doc.textBetween(from, to, ' ');
      setSelection(text.trim().length >= 20 ? { from, to, text } : null);
    };
    editor.on('selectionUpdate', update);
    editor.on('transaction', update);
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('transaction', update);
    };
  }, [editor]);

  const run = useCallback(
    async (command: string) => {
      if (!editor || !selection) return;
      setBusy(command);
      try {
        const before = editor.state.doc.textBetween(
          Math.max(0, selection.from - 800),
          selection.from,
          ' ',
        );
        const after = editor.state.doc.textBetween(
          selection.to,
          Math.min(editor.state.doc.content.size, selection.to + 800),
          ' ',
        );
        const answer = await api<RunResult>('/commands/run', {
          method: 'POST',
          body: JSON.stringify({
            chapterId,
            command,
            selection: selection.text,
            contextBefore: before,
            contextAfter: after,
          }),
        });
        setResult(answer);
        onUsageChange();
        if (answer.unchanged) {
          onNotice('Nothing conflicted with the section or your glossary; the text is unchanged.');
        }
      } catch (e) {
        onNotice(
          e instanceof ApiError
            ? (e.problem.detail ?? e.problem.title)
            : 'That command did not run.',
        );
      } finally {
        setBusy(null);
      }
    },
    [editor, selection, chapterId, onUsageChange, onNotice],
  );

  function apply() {
    if (!editor || !selection || !result) return;
    // FR-4.11: applied text is COMMAND provenance, set on the range we just inserted.
    editor
      .chain()
      .focus()
      .insertContentAt({ from: selection.from, to: selection.to }, result.text)
      .command(({ tr, state, dispatch }) => {
        const to = state.selection.from;
        const from = Math.max(0, to - result.text.length);
        if (dispatch) {
          const mark = state.schema.marks.provenance;
          if (mark) {
            tr.addMark(from, to, mark.create({ kind: 'COMMAND', actionId: null }));
          }
        }
        void tr;
        return true;
      })
      .run();
    setResult(null);
    setSelection(null);
  }

  if (!selection && !result) return null;

  return (
    <aside
      data-testid="command-toolbar"
      className="fixed bottom-16 left-1/2 z-30 w-[36rem] max-w-[92vw] -translate-x-1/2 lg:bottom-4 rounded-md border border-line bg-surface p-3 shadow-lg"
    >
      {result ? (
        <>
          <div className="flex items-baseline justify-between text-sm">
            <p className="font-medium">
              {result.command} · {result.originalWords} → {result.words} words
            </p>
            <span className="text-xs text-muted">Nothing is applied until you press Apply.</span>
          </div>
          {/* Ops are positional by nature: the key pairs the op's own text with its offset. */}
          <div
            data-testid="command-diff"
            className="mt-2 max-h-56 overflow-y-auto rounded-md border border-line bg-paper p-2 text-sm leading-relaxed"
          >
            {diffKeys(result.diff).map(({ op, key }) => (
              <span
                key={key}
                className={
                  op.type === 'add'
                    ? 'bg-accent/15 text-ink'
                    : op.type === 'remove'
                      ? 'bg-warn/15 text-muted line-through'
                      : ''
                }
              >
                {op.text}
              </span>
            ))}
          </div>
          {result.droppedCitations.length > 0 ? (
            <p role="alert" className="mt-2 text-xs text-warn">
              {result.droppedCitations.length} citation
              {result.droppedCitations.length === 1 ? '' : 's'} in the selection are missing from
              the rewrite. Check the claims they supported before applying.
            </p>
          ) : null}
          <div className="mt-3 flex justify-end gap-3 text-sm">
            <button type="button" className="underline" onClick={() => setResult(null)}>
              Discard
            </button>
            <button
              type="button"
              onClick={apply}
              disabled={result.unchanged}
              className="rounded-md px-3 py-1 disabled:opacity-40 bg-accent text-accent-ink hover:bg-accent-hover font-semibold transition-colors"
              data-testid="command-apply"
            >
              Apply
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-xs text-muted">
            {selection ? `${selection.text.trim().split(/\s+/).length} words selected` : ''} · one
            Strong call each, counted against your Command allowance
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {COMMANDS.map((c) => (
              <button
                key={c.key}
                type="button"
                disabled={busy !== null}
                onClick={() => void run(c.key)}
                className="rounded-md border border-line-strong bg-surface px-3 py-1 text-sm disabled:opacity-50 font-semibold text-ink transition-colors hover:bg-sunk"
              >
                {busy === c.key ? 'Working…' : c.label}
              </button>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}
