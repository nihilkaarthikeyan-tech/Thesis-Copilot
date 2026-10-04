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

import { aiTextToFragment, citationsInRange } from '@tc/ui';
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
  /** Citations the rewrite added from the passages it was sent, resolved (ADR-0045). */
  citations?: Array<{ key: string; sourceId: string; chunkId: string; rendered: string }>;
  unchanged: boolean;
};

/**
 * The preview shows what the student will see, not the wire format: a citation marker reads as
 * its label and an equation as its source without the dollar signs (ADR-0045). Markers for
 * citations already in the chapter take the label the editor holds; new ones take the server's.
 */
function readable(text: string, editor: Editor | null, result: RunResult): string {
  const labels =
    (editor?.storage as { citation?: { renderedMap?: Record<string, string> } } | undefined)
      ?.citation?.renderedMap ?? {};
  const added = new Map((result.citations ?? []).map((c) => [c.key, c.rendered]));
  return text
    .replace(/\{\{cite:([^}]+)\}\}/g, (_m, key: string) => {
      const k = key.trim();
      return labels[k] ?? added.get(k) ?? '';
    })
    .replace(/\$\$([^$]+)\$\$|\$([^$\n]+)\$/g, (_m, display?: string, inline?: string) =>
      (display ?? inline ?? '').trim(),
    );
}

const COMMANDS = [
  { key: 'expand', label: 'Expand' },
  { key: 'formalise', label: 'Formalise' },
  { key: 'simplify', label: 'Simplify' },
  { key: 'shorten', label: 'Shorten' },
  { key: 'consistency', label: 'Check consistency' },
] as const;

/** ADR-0066: more edits, behind one disclosure so the row stays short. */
const MORE_EDITS = [
  { key: 'hedge', label: 'Hedge', title: 'More cautious claims where the evidence is limited' },
  {
    key: 'direct',
    label: 'More direct',
    title: 'Fewer needless qualifiers — only on claims that carry a citation',
  },
  { key: 'active', label: 'Active voice', title: 'Active voice where the doer is named' },
  { key: 'past', label: 'Past tense', title: 'For reporting what a study did' },
  { key: 'present', label: 'Present tense', title: 'For what is known and argued' },
  {
    key: 'counter',
    label: 'Counter-argument',
    title: 'Adds a cited counter-argument from your library after your text',
  },
] as const;

export function CommandToolbar({
  editor,
  documentId,
  chapterId,
  onUsageChange,
  onNotice,
  onAskChat,
  onFindPapers,
}: {
  editor: Editor | null;
  documentId: string;
  chapterId: string;
  onUsageChange: () => void;
  onNotice: (message: string) => void;
  /** Opens the chat with the selected text in the box (2026-10-04, from the Jenni study). */
  onAskChat?: (text: string) => void;
  /** Opens the Papers tab searching for the selected sentence (2026-10-04, Jenni study). */
  onFindPapers?: (text: string) => void;
}) {
  /**
   * A note on the selected passage (2026-10-04, from the Jenni study): only a guide could
   * comment, so a student could not leave themselves a "check this figure" on their own text.
   * The note is an ordinary comment, found again from its quoted text like a guide's.
   */
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
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

  /** The command the preview came from, for "Try again". */
  const [lastCommand, setLastCommand] = useState<string | null>(null);

  const run = useCallback(
    async (command: string) => {
      if (!editor || !selection) return;
      setBusy(command);
      setLastCommand(command);
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

  /**
   * Places the rewrite after the selected passage instead of over it (2026-10-04, from the Jenni
   * study: Replace / Insert below / Try again / Discard). The original stays; the student keeps
   * the better of the two.
   */
  function insertBelow() {
    if (!editor || !selection || !result) return;
    const store = (editor.storage as { citation?: { renderedMap?: Record<string, string> } })
      .citation;
    const fragment = aiTextToFragment(editor.schema, result.text, {
      provenance: { kind: 'COMMAND', actionId: null },
      existing: citationsInRange(editor.state.doc, selection.from, selection.to),
      citations: result.citations ?? [],
      onCitation: (key, rendered) => {
        if (store?.renderedMap && rendered) store.renderedMap[key] = rendered;
      },
    });
    const $to = editor.state.doc.resolve(selection.to);
    const after = $to.after($to.depth);
    const paragraph = editor.schema.nodes.paragraph?.create(null, fragment);
    if (!paragraph) return;
    editor
      .chain()
      .focus()
      .command(({ tr, dispatch }) => {
        if (dispatch) tr.insert(after, paragraph);
        return true;
      })
      .run();
    setResult(null);
    setSelection(null);
  }

  function apply() {
    if (!editor || !selection || !result) return;
    // FR-4.11: applied text is COMMAND provenance. The answer is text with `{{cite:KEY}}` markers
    // and `$…$` equations; before ADR-0045 it was inserted as a plain string, which deleted every
    // citation and equation that had been inside the selection and left any marker the model
    // wrote as literal text. The citations that were in the selection are kept as they were;
    // the ones the rewrite added get fresh nodes with the server's label.
    const store = (editor.storage as { citation?: { renderedMap?: Record<string, string> } })
      .citation;
    const fragment = aiTextToFragment(editor.schema, result.text, {
      provenance: { kind: 'COMMAND', actionId: null },
      existing: citationsInRange(editor.state.doc, selection.from, selection.to),
      citations: result.citations ?? [],
      onCitation: (key, rendered) => {
        if (store?.renderedMap && rendered) store.renderedMap[key] = rendered;
      },
    });
    editor
      .chain()
      .focus()
      .command(({ tr, dispatch }) => {
        if (dispatch) tr.replaceWith(selection.from, selection.to, fragment);
        return true;
      })
      .setTextSelection(selection.from + fragment.size)
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
            <span className="text-xs text-muted">
              Nothing changes until you press Replace or Insert below.
            </span>
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
                {readable(op.text, editor, result)}
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
            {lastCommand ? (
              <button
                type="button"
                className="underline"
                disabled={busy !== null}
                data-testid="command-retry"
                onClick={() => void run(lastCommand)}
              >
                {busy ? 'Working…' : 'Try again'}
              </button>
            ) : null}
            <button
              type="button"
              className="underline disabled:opacity-40"
              disabled={result.unchanged}
              data-testid="command-insert-below"
              onClick={insertBelow}
            >
              Insert below
            </button>
            <button
              type="button"
              onClick={apply}
              disabled={result.unchanged}
              className="rounded-md px-3 py-1 disabled:opacity-40 bg-accent text-accent-ink hover:bg-accent-hover font-semibold transition-colors"
              data-testid="command-apply"
            >
              Replace
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-xs text-muted">
            {selection ? `${selection.text.trim().split(/\s+/).length} words selected` : ''} · each
            uses one of your section commands this month
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="comment-on-selection"
              aria-expanded={noteOpen}
              onClick={() => setNoteOpen((open) => !open)}
              className="rounded-md border border-line-strong bg-surface px-3 py-1 text-sm font-semibold text-ink transition-colors hover:bg-sunk"
            >
              Comment
            </button>
            {onFindPapers ? (
              <button
                type="button"
                data-testid="find-papers-on-selection"
                onClick={() => selection && onFindPapers(selection.text)}
                className="rounded-md border border-line-strong bg-surface px-3 py-1 text-sm font-semibold text-ink transition-colors hover:bg-sunk"
              >
                Find papers
              </button>
            ) : null}
            {onAskChat ? (
              <button
                type="button"
                data-testid="ask-chat-on-selection"
                onClick={() => selection && onAskChat(selection.text)}
                className="rounded-md border border-line-strong bg-surface px-3 py-1 text-sm font-semibold text-ink transition-colors hover:bg-sunk"
              >
                Ask chat
              </button>
            ) : null}
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
            <details className="w-full" data-testid="more-edits">
              <summary className="cursor-pointer text-xs font-semibold text-muted hover:text-ink">
                More edits
              </summary>
              <div className="mt-1 flex flex-wrap gap-2">
                {MORE_EDITS.map((c) => {
                  // "More direct" only firms up claims that already carry a citation.
                  const needsCite = c.key === 'direct' && !selection?.text.includes('{{cite:');
                  return (
                    <button
                      key={c.key}
                      type="button"
                      title={needsCite ? 'Select a sentence that carries a citation' : c.title}
                      disabled={busy !== null || needsCite}
                      onClick={() => void run(c.key)}
                      className="rounded-md border border-line-strong bg-surface px-3 py-1 text-sm disabled:opacity-50 font-semibold text-ink transition-colors hover:bg-sunk"
                    >
                      {busy === c.key ? 'Working…' : c.label}
                    </button>
                  );
                })}
              </div>
            </details>
          </div>
          {noteOpen && selection ? (
            <form
              className="mt-2 grid gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const body = note.trim();
                if (!body) return;
                setSavingNote(true);
                void api(`/documents/${documentId}/feedback/comments`, {
                  method: 'POST',
                  body: JSON.stringify({ chapterId, body, quotedText: selection.text.trim() }),
                })
                  .then(() => {
                    setNote('');
                    setNoteOpen(false);
                    onNotice('Comment added. It is listed under Review, on the passage.');
                  })
                  .catch((error: unknown) =>
                    onNotice(
                      error instanceof ApiError
                        ? (error.problem.detail ?? error.problem.title)
                        : 'The comment was not saved. Try again.',
                    ),
                  )
                  .finally(() => setSavingNote(false));
              }}
            >
              <label className="text-xs text-muted" htmlFor="own-comment">
                Your comment on the selected text
              </label>
              <textarea
                id="own-comment"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={2000}
                rows={2}
                className="rounded-md border border-line-strong bg-surface px-2 py-1 text-sm text-ink"
                placeholder="e.g. check this figure against the 2023 report"
              />
              <button
                type="submit"
                disabled={savingNote || !note.trim()}
                className="justify-self-start rounded-md bg-accent px-3 py-1 text-sm font-semibold text-accent-ink disabled:opacity-50"
              >
                {savingNote ? 'Saving…' : 'Save comment'}
              </button>
            </form>
          ) : null}
        </>
      )}
    </aside>
  );
}
