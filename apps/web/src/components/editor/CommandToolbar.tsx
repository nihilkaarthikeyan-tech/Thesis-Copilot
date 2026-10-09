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
import { useCallback, useEffect, useRef, useState } from 'react';
import { tNow } from '@/i18n';
import { useT } from '@/i18n/react';
import { ApiError, api } from '@/lib/api';
import {
  addedHeading,
  addedLabel,
  commandRunBody,
  type EditLiterature,
  literatureApplies,
} from '@/lib/edit-literature';
import { type LimitNoticeMessage, limitNotice, limitRefusal } from '@/lib/limit';
import { readerHref } from '@/lib/reader';
import { listNodeFromMarkdown } from './list-from-markdown';
import { tableNodeFromMarkdown } from './table-from-markdown';

/** Dispatched on `window` by Ctrl+J with a selection: the caret goes to the edit box. */
export const AI_EDIT_FOCUS = 'tc:ai-edit-focus';
/**
 * Dispatched on `window` with `{ command, instruction? }` (R9, the paste menu): run that edit on
 * the selection just made. Met on the first render that has the selection.
 */
export const AI_EDIT_RUN = 'tc:ai-edit-run';
export type AiEditRunDetail = { command: string; instruction?: string };

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
  /** ADR-0095: citations now on another claim — a warning before Replace, like a dropped one. */
  movedCitations?: string[];
  /** ADR-0095: a citation written twice where the copy is part of a sentence — a warning. */
  repeatedCitations?: string[];
  /** ADR-0095: "What changed and why", asked for once with this. */
  runId?: string;
  /** ADR-0133: the papers "Search the literature" added to the library, or why it added none. */
  literature?: EditLiterature;
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

type Preset = {
  key: string;
  /** An i18n key for the five A.11 commands that have one; the rest are English for now. */
  label: string;
  title: string;
};

/**
 * ADR-0095 (Jenni build plan R8): every edit, in the groups Jenni's AI Edit uses. Typing in the
 * box filters them; anything typed that is not one of them is the student's own instruction.
 * There is no general "Paraphrase": rewording any selection on request is the §12.3 ban.
 */
const isList = (command: string) => command === 'bullets' || command === 'numbered';

const PRESET_GROUPS: Array<{ title: string; presets: Preset[] }> = [
  {
    title: 'Improve the writing',
    presets: [
      { key: 'flow', label: 'Fix the flow', title: 'Each sentence follows from the one before' },
      {
        key: 'transitions',
        label: 'Add transitions',
        title: 'Linking words where the relation is clear',
      },
      {
        key: 'redundancy',
        label: 'Remove repetition',
        title: 'Drops what says the same thing twice',
      },
      {
        key: 'strengthen',
        label: 'Strengthen the argument',
        title: 'Claim, evidence and what follows, made explicit',
      },
      {
        key: 'counter',
        label: 'Counter-argument',
        title: 'Adds a cited counter-argument from your library after your text',
      },
      { key: 'expand', label: 'command.expand', title: 'Adds depth from your library, cited' },
      { key: 'shorten', label: 'command.shorten', title: 'About 60% of the length' },
    ],
  },
  {
    title: 'Academic style',
    presets: [
      {
        key: 'formalise',
        label: 'command.formalise',
        title: 'A formal academic register, same meaning and length',
      },
      { key: 'simplify', label: 'command.simplify', title: 'Shorter sentences, plainer words' },
      {
        key: 'precise',
        label: 'Technical precision',
        title: "The field's exact terms and the text's own figures",
      },
      {
        key: 'direct',
        label: 'Increase confidence',
        title: 'Fewer needless qualifiers — only on claims that carry a citation',
      },
      {
        key: 'hedge',
        label: 'Hedge the claims',
        title: 'More cautious claims where the evidence is limited',
      },
      {
        key: 'consistency',
        label: 'command.consistency',
        title: 'Fixes terms that conflict with the section and glossary',
      },
    ],
  },
  {
    title: 'Transform',
    presets: [
      { key: 'active', label: 'Active voice', title: 'Active voice where the doer is named' },
      { key: 'past', label: 'Past tense', title: 'For reporting what a study did' },
      { key: 'present', label: 'Present tense', title: 'For what is known and argued' },
      {
        key: 'future',
        label: 'Future tense',
        title: 'For what this research will do, as in a proposal',
      },
      { key: 'bullets', label: 'Bulleted list', title: 'One point per item, citations kept' },
      { key: 'numbered', label: 'Numbered list', title: 'One point per item, in order' },
      { key: 'prose', label: 'As prose', title: 'A list or notes as connected paragraphs' },
      {
        key: 'table',
        label: 'As a table',
        title: 'The facts the text compares, as a table; nothing added',
      },
      {
        key: 'translate',
        label: 'Translate',
        title: 'Into the language of this thesis, every citation and figure kept',
      },
    ],
  },
];

export function CommandToolbar({
  editor,
  documentId,
  chapterId,
  onUsageChange,
  onNotice,
  onAskChat,
  onFindPapers,
  onReviewSelection,
}: {
  editor: Editor | null;
  documentId: string;
  chapterId: string;
  onUsageChange: () => void;
  /** A message for the editor's strip; a limit refusal is drawn as the limit message (R31). */
  onNotice: (message: string | LimitNoticeMessage) => void;
  /** Opens the chat with the selected text in the box (2026-10-04, from the Jenni study). */
  onAskChat?: (text: string) => void;
  /** Opens the Papers tab searching for the selected sentence (2026-10-04, Jenni study). */
  onFindPapers?: (text: string) => void;
  /** ADR-0067: an examiner review of just the selection (one section command unit). */
  onReviewSelection?: (from: number, to: number) => void;
}) {
  const { t } = useT();
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
  /** ADR-0095: the box — it filters the presets, or is the student's own instruction. */
  const [instruction, setInstruction] = useState('');
  /** ADR-0095: "Use my library" — the student's own instruction is sent passages when on. */
  const [useLibrary, setUseLibrary] = useState(true);
  /**
   * ADR-0133: "Search the literature" — the indexes are searched and the few papers on topic are
   * added to the library before the edit cites them. Off by default: it adds papers.
   */
  const [searchLiterature, setSearchLiterature] = useState(false);
  /** ADR-0133: the papers added by this panel's runs, kept across a follow-up. */
  const [literature, setLiterature] = useState<EditLiterature | null>(null);
  /** ADR-0095: "What changed and why"; null while it is being worked out. */
  const [reasons, setReasons] = useState<string[] | null>(null);
  const [followUp, setFollowUp] = useState('');
  /**
   * ADR-0095: a follow-up refines the result, so the student's original text and every citation
   * the earlier rounds added are kept here, for the diff and for Replace.
   */
  const [original, setOriginal] = useState<string | null>(null);
  const [addedCitations, setAddedCitations] = useState<NonNullable<RunResult['citations']>>([]);
  const inputRef = useRef<HTMLInputElement>(null);

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
  const [lastCommand, setLastCommand] = useState<{ command: string; instruction?: string } | null>(
    null,
  );

  const run = useCallback(
    async (command: string, options: { instruction?: string; followUp?: boolean } = {}) => {
      if (!editor || !selection) return;
      setBusy(command);
      setLastCommand({
        command,
        ...(options.instruction ? { instruction: options.instruction } : {}),
      });
      // A follow-up rewrites the last result; anything else starts from the selection again.
      const refining = options.followUp === true && result !== null;
      const base = original ?? selection.text;
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
          body: JSON.stringify(
            commandRunBody({
              chapterId,
              command,
              selection: refining && result ? result.text : selection.text,
              contextBefore: before,
              contextAfter: after,
              ...(options.instruction ? { instruction: options.instruction } : {}),
              useLibrary,
              searchLiterature,
              ...(refining ? { original: base } : {}),
            }),
          ),
        });
        setOriginal(base);
        // A follow-up does not search again; the papers the first run added stay listed.
        if (answer.literature || !refining) setLiterature(answer.literature ?? null);
        setAddedCitations((previous) => {
          const merged = refining ? [...previous] : [];
          for (const c of answer.citations ?? []) {
            if (!merged.some((m) => m.key === c.key)) merged.push(c);
          }
          return merged;
        });
        setResult(answer);
        setFollowUp('');
        setReasons(null);
        onUsageChange();
        if (answer.unchanged) {
          onNotice(tNow('command.noConflict'));
        }
        // ADR-0095: "What changed and why", once, inside the unit just spent.
        if (answer.runId && !answer.unchanged) {
          api<{ reasons: string[] }>('/commands/explain', {
            method: 'POST',
            body: JSON.stringify({ runId: answer.runId }),
          })
            .then((r) => setReasons(r.reasons))
            .catch(() => setReasons([]));
        } else {
          setReasons([]);
        }
      } catch (e) {
        const limit = limitRefusal(e);
        onNotice(
          limit
            ? limitNotice(limit)
            : e instanceof ApiError
              ? (e.problem.detail ?? e.problem.title)
              : tNow('command.failed'),
        );
      } finally {
        setBusy(null);
      }
    },
    [
      editor,
      selection,
      chapterId,
      onUsageChange,
      onNotice,
      result,
      original,
      useLibrary,
      searchLiterature,
    ],
  );

  /** Clears the panel after Replace, Insert below or Discard. */
  function reset() {
    setResult(null);
    setReasons(null);
    setOriginal(null);
    setAddedCitations([]);
    setLiterature(null);
    setFollowUp('');
  }

  /** The box's Enter: a preset whose name was typed in full, or the student's own instruction. */
  function submitBox() {
    const typed = instruction.trim();
    if (!typed) return;
    const exact = PRESET_GROUPS.flatMap((g) => g.presets).find(
      (p) => presetLabel(p).toLowerCase() === typed.toLowerCase(),
    );
    if (exact) void run(exact.key);
    else void run('custom', { instruction: typed });
  }

  const presetLabel = (p: Preset) =>
    p.label.startsWith('command.') ? t(p.label as Parameters<typeof t>[0]) : p.label;
  const commandName = (key: string) => {
    if (key === 'custom') return 'Your instruction';
    const preset = PRESET_GROUPS.flatMap((g) => g.presets).find((p) => p.key === key);
    return preset ? presetLabel(preset) : key;
  };

  // Ctrl+J (ThesisEditor) puts the caret in the box when there is a selection. The key can come
  // before React has drawn the box for a selection just made, so the wish is kept and met on the
  // first render that has the box (seen under load in the browser suite).
  const focusWanted = useRef(false);
  useEffect(() => {
    const focus = () => {
      focusWanted.current = true;
      if (inputRef.current) {
        inputRef.current.focus();
        focusWanted.current = false;
      }
    };
    window.addEventListener(AI_EDIT_FOCUS, focus);
    return () => window.removeEventListener(AI_EDIT_FOCUS, focus);
  }, []);
  useEffect(() => {
    if (focusWanted.current && inputRef.current) {
      inputRef.current.focus();
      focusWanted.current = false;
    }
  });
  // R9: an edit asked for from outside (the paste menu), run once the selection has arrived.
  const runWanted = useRef<AiEditRunDetail | null>(null);
  const [, poke] = useState(0);
  useEffect(() => {
    const onRun = (event: Event) => {
      runWanted.current = (event as CustomEvent<AiEditRunDetail>).detail;
      // A render, so the effect below sees the wish even if the selection rendered already.
      poke((n) => n + 1);
    };
    window.addEventListener(AI_EDIT_RUN, onRun);
    return () => window.removeEventListener(AI_EDIT_RUN, onRun);
  }, []);
  useEffect(() => {
    const wanted = runWanted.current;
    if (!wanted || !selection || busy !== null) return;
    runWanted.current = null;
    void run(wanted.command, wanted.instruction ? { instruction: wanted.instruction } : {});
  });

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
      citations: addedCitations,
      onCitation: (key, rendered) => {
        if (store?.renderedMap && rendered) store.renderedMap[key] = rendered;
      },
    });
    const $to = editor.state.doc.resolve(selection.to);
    const after = $to.after($to.depth);
    // ADR-0095: a list goes in as a list.
    const listed = isList(result.command)
      ? listNodeFromMarkdown(editor.schema, result.text, {
          provenance: { kind: 'COMMAND', actionId: null },
          existing: citationsInRange(editor.state.doc, selection.from, selection.to),
          citations: addedCitations,
        })
      : null;
    const paragraph = listed ?? editor.schema.nodes.paragraph?.create(null, fragment);
    if (!paragraph) return;
    editor
      .chain()
      .focus()
      .command(({ tr, dispatch }) => {
        if (dispatch) tr.insert(after, paragraph);
        return true;
      })
      .run();
    reset();
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
    const options = {
      provenance: { kind: 'COMMAND' as const, actionId: null },
      existing: citationsInRange(editor.state.doc, selection.from, selection.to),
      citations: addedCitations,
      onCitation: (key: string, rendered: string | null) => {
        if (store?.renderedMap && rendered) store.renderedMap[key] = rendered;
      },
    };
    // ADR-0081: "As a table" answers with a Markdown table, which replaces the selected paragraph
    // as a real table node (the "/" menu's kind), its citations as citation nodes.
    // ADR-0095: likewise a bulleted or numbered list replaces it as a real list.
    const table =
      result.command === 'table'
        ? tableNodeFromMarkdown(editor.schema, result.text, options)
        : isList(result.command)
          ? listNodeFromMarkdown(editor.schema, result.text, options)
          : null;
    if (table) {
      const $from = editor.state.doc.resolve(selection.from);
      const $to = editor.state.doc.resolve(selection.to);
      const from = $from.before($from.depth);
      const to = $to.after($to.depth);
      editor
        .chain()
        .focus()
        .command(({ tr, dispatch }) => {
          if (dispatch) tr.replaceWith(from, to, table);
          return true;
        })
        .run();
      reset();
      setSelection(null);
      return;
    }
    const fragment = aiTextToFragment(editor.schema, result.text, options);
    editor
      .chain()
      .focus()
      .command(({ tr, dispatch }) => {
        if (dispatch) tr.replaceWith(selection.from, selection.to, fragment);
        return true;
      })
      .setTextSelection(selection.from + fragment.size)
      .run();
    reset();
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
              {t('command.resultWords', {
                command: commandName(result.command),
                from: result.originalWords,
                to: result.words,
              })}
            </p>
            <span className="text-xs text-muted">{t('command.nothingChanges')}</span>
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
                {readable(op.text, editor, { ...result, citations: addedCitations })}
              </span>
            ))}
          </div>
          {result.droppedCitations.length > 0 ? (
            <p role="alert" className="mt-2 text-xs text-warn">
              {t(
                result.droppedCitations.length === 1 ? 'command.droppedOne' : 'command.droppedMany',
                { n: result.droppedCitations.length },
              )}
            </p>
          ) : null}
          {(result.movedCitations?.length ?? 0) > 0 ? (
            <p role="alert" className="mt-2 text-xs text-warn" data-testid="command-moved">
              {result.movedCitations?.length === 1
                ? 'One citation now sits on a different claim. Check it before you replace your text.'
                : `${result.movedCitations?.length} citations now sit on different claims. Check them before you replace your text.`}
            </p>
          ) : null}
          {(result.repeatedCitations?.length ?? 0) > 0 ? (
            <p role="alert" className="mt-2 text-xs text-warn" data-testid="command-repeated">
              A citation now appears twice in this version. Check that each one belongs where it is.
            </p>
          ) : null}
          {literature && (literature.added.length > 0 || literature.note) ? (
            <div className="mt-2 text-xs" data-testid="command-literature">
              {literature.added.length > 0 ? (
                <>
                  <p className="font-semibold text-ink">{addedHeading(literature)}</p>
                  <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                    {literature.added.map((paper) => (
                      <li key={paper.sourceId} className="min-w-0 max-w-full">
                        <a
                          href={readerHref(documentId, paper.sourceId)}
                          target="_blank"
                          rel="noreferrer"
                          title={paper.title}
                          data-testid="command-literature-paper"
                          className="block truncate text-accent underline"
                        >
                          {addedLabel(paper)}
                        </a>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              {literature.note ? (
                <p className="mt-1 text-muted" data-testid="command-literature-note">
                  {literature.note}
                </p>
              ) : null}
            </div>
          ) : null}
          {result.unchanged ? null : (
            <div className="mt-2" data-testid="command-reasons">
              <p className="text-xs font-semibold text-ink">What changed and why</p>
              {reasons === null ? (
                <p className="mt-1 text-xs text-muted">Working it out…</p>
              ) : reasons.length > 0 ? (
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted">
                  {reasons.map((reason) => (
                    <li key={reason} className={reason.startsWith('Check:') ? 'text-warn' : ''}>
                      {/* A citation marker the model quoted reads as its label, as in the diff. */}
                      {readable(reason, editor, { ...result, citations: addedCitations })}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-muted">Compare the two versions above.</p>
              )}
            </div>
          )}
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const asked = followUp.trim();
              if (asked) void run('custom', { instruction: asked, followUp: true });
            }}
          >
            <input
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
              maxLength={500}
              placeholder="Ask for a change to this version…"
              aria-label="Ask for a change to this version"
              data-testid="command-follow-up"
              className="min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-2 py-1 text-sm text-ink"
            />
            <button
              type="submit"
              disabled={busy !== null || !followUp.trim()}
              className="rounded-md border border-line-strong px-3 py-1 text-sm font-semibold text-ink disabled:opacity-50"
              data-testid="command-follow-up-send"
            >
              {busy === 'custom' ? t('command.working') : 'Refine'}
            </button>
          </form>
          <div className="mt-3 flex justify-end gap-3 text-sm">
            <button type="button" className="underline" onClick={reset}>
              {t('common.discard')}
            </button>
            {lastCommand ? (
              <button
                type="button"
                className="underline"
                disabled={busy !== null}
                data-testid="command-retry"
                onClick={() =>
                  void run(
                    lastCommand.command,
                    lastCommand.instruction ? { instruction: lastCommand.instruction } : {},
                  )
                }
              >
                {busy ? t('command.working') : t('command.tryAgain')}
              </button>
            ) : null}
            <button
              type="button"
              className="underline disabled:opacity-40"
              disabled={result.unchanged}
              data-testid="command-insert-below"
              onClick={insertBelow}
            >
              {t('command.insertBelow')}
            </button>
            <button
              type="button"
              onClick={apply}
              disabled={result.unchanged}
              className="rounded-md px-3 py-1 disabled:opacity-40 bg-accent text-accent-ink hover:bg-accent-hover font-semibold transition-colors"
              data-testid="command-apply"
            >
              {t('command.replace')}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-xs text-muted">
            {selection
              ? t('command.wordsSelected', { n: selection.text.trim().split(/\s+/).length })
              : ''}
            {t('command.costNote')}
          </p>
          {/* ADR-0095: one box — it filters the edits below, or is your own instruction. */}
          <form
            className="mt-2 flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submitBox();
            }}
          >
            <input
              id="ai-edit-input"
              ref={inputRef}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setInstruction('');
              }}
              maxLength={500}
              placeholder="Edit with AI: say what to change, or pick below (Ctrl+J)"
              aria-label="Edit with AI"
              data-testid="ai-edit-input"
              className="min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink"
            />
            <button
              type="submit"
              disabled={busy !== null || !instruction.trim()}
              className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-accent-ink disabled:opacity-50"
              data-testid="ai-edit-send"
            >
              {busy === 'custom' ? t('command.working') : 'Edit'}
            </button>
          </form>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <label
              className="flex items-center gap-1"
              title="Your own instruction may use passages from your library, cited"
            >
              <input
                type="checkbox"
                checked={useLibrary || searchLiterature}
                disabled={searchLiterature}
                onChange={(e) => setUseLibrary(e.target.checked)}
                data-testid="ai-edit-library"
                className="accent-accent"
              />
              Use my library
            </label>
            <label
              className="flex items-center gap-1"
              title="Searches the scholarly indexes and adds the few papers on this passage to your library before the edit cites them. Your own instruction, Expand, Check consistency and Counter-argument."
            >
              <input
                type="checkbox"
                checked={searchLiterature}
                onChange={(e) => setSearchLiterature(e.target.checked)}
                data-testid="ai-edit-literature"
                className="accent-accent"
              />
              Search the literature
            </label>
          </div>
          {busy && searchLiterature && literatureApplies(busy) ? (
            <p className="mt-1 text-xs text-muted" role="status" data-testid="ai-edit-searching">
              Searching the literature and adding what fits to your library…
            </p>
          ) : null}
          <div className="mt-2 max-h-56 overflow-y-auto" data-testid="ai-edit-presets">
            {PRESET_GROUPS.map((group) => {
              const typed = instruction.trim().toLowerCase();
              const shown = group.presets.filter(
                (p) =>
                  !typed ||
                  presetLabel(p).toLowerCase().includes(typed) ||
                  p.title.toLowerCase().includes(typed),
              );
              if (shown.length === 0) return null;
              return (
                <div key={group.title} className="mb-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                    {group.title}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {shown.map((p) => {
                      // "Increase confidence" only firms up claims that already carry a citation.
                      const needsCite = p.key === 'direct' && !selection?.text.includes('{{cite:');
                      return (
                        <button
                          key={p.key}
                          type="button"
                          title={needsCite ? 'Select a sentence that carries a citation' : p.title}
                          disabled={busy !== null || needsCite}
                          onClick={() => void run(p.key)}
                          data-testid={`ai-edit-${p.key}`}
                          className="rounded-md border border-line-strong bg-surface px-2.5 py-1 text-[13px] font-semibold text-ink transition-colors hover:bg-sunk disabled:opacity-50"
                        >
                          {busy === p.key ? t('command.working') : presetLabel(p)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="comment-on-selection"
              aria-expanded={noteOpen}
              onClick={() => setNoteOpen((open) => !open)}
              className="rounded-md border border-line-strong bg-surface px-3 py-1 text-sm font-semibold text-ink transition-colors hover:bg-sunk"
            >
              {t('command.comment')}
            </button>
            {onFindPapers ? (
              <button
                type="button"
                data-testid="find-papers-on-selection"
                onClick={() => selection && onFindPapers(selection.text)}
                className="rounded-md border border-line-strong bg-surface px-3 py-1 text-sm font-semibold text-ink transition-colors hover:bg-sunk"
              >
                {t('common.findPapers')}
              </button>
            ) : null}
            {onReviewSelection ? (
              <button
                type="button"
                data-testid="review-selection"
                title="An examiner reads just these sentences against their sources — one section command"
                onClick={() => selection && onReviewSelection(selection.from, selection.to)}
                className="rounded-md border border-line-strong bg-surface px-3 py-1 text-sm font-semibold text-ink transition-colors hover:bg-sunk"
              >
                Examiner review
              </button>
            ) : null}
            {onAskChat ? (
              <button
                type="button"
                data-testid="ask-chat-on-selection"
                onClick={() => selection && onAskChat(selection.text)}
                className="rounded-md border border-line-strong bg-surface px-3 py-1 text-sm font-semibold text-ink transition-colors hover:bg-sunk"
              >
                {t('command.askChat')}
              </button>
            ) : null}
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
                    onNotice(tNow('command.commentAdded'));
                  })
                  .catch((error: unknown) =>
                    onNotice(
                      error instanceof ApiError
                        ? (error.problem.detail ?? error.problem.title)
                        : tNow('command.commentFailed'),
                    ),
                  )
                  .finally(() => setSavingNote(false));
              }}
            >
              <label className="text-xs text-muted" htmlFor="own-comment">
                {t('command.commentLabel')}
              </label>
              <textarea
                id="own-comment"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={2000}
                rows={2}
                className="rounded-md border border-line-strong bg-surface px-2 py-1 text-sm text-ink"
                placeholder={t('command.commentPlaceholder')}
              />
              <button
                type="submit"
                disabled={savingNote || !note.trim()}
                className="justify-self-start rounded-md bg-accent px-3 py-1 text-sm font-semibold text-accent-ink disabled:opacity-50"
              >
                {savingNote ? t('common.saving') : t('command.saveComment')}
              </button>
            </form>
          ) : null}
        </>
      )}
    </aside>
  );
}
