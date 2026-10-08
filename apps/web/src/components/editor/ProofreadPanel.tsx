'use client';

/**
 * Spelling and grammar — ADR-0026.
 *
 * Reads the chapter for mistakes and lists each correction; nothing changes until the student
 * accepts one, and then only that span does — "flag, don't fix", the rule every AI feature keeps.
 *
 * ## What this must never become
 *
 * PRD §12.3 bans humanise and detector-evasion tooling. A proofreader is the nearest honest thing
 * to one, and the line is that a correction never puts a different word in: it fixes a spelling,
 * a grammar word, punctuation or a doubled word, and the wording stays the student's. The server
 * refuses anything else before it gets here (`correctionSize`), and this panel has no "rewrite"
 * action to add one back.
 *
 * A correction is placed in the chapter as it is *now* (`locateSpan`), because the student may
 * have typed since the run. One whose words are no longer there says so, and is not applied.
 */

import type { Editor } from '@tiptap/core';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { locateSpan, type TextRun } from '@/lib/proofread';
import { openCheck, type ReviewItem, startReview } from '@/lib/review-mode';

type Correction = {
  sentenceId: string;
  original: string;
  replacement: string;
  kind: 'spelling' | 'grammar' | 'punctuation' | 'agreement' | 'tone';
  why: string;
  sentence: string;
  near: number;
};

/** ADR-0084: the panel in its second mode reviews tone against a sample, not spelling. */
type Mode = 'proofread' | 'tone';

type SampleOption = { id: string; title: string };

type RunResult = {
  corrections: Correction[];
  checkedWords: number;
  totalWords: number;
  refused: number;
  nextSentence: number | null;
};

const KIND_LABEL: Record<Correction['kind'], string> = {
  spelling: 'Spelling',
  grammar: 'Grammar',
  punctuation: 'Punctuation',
  agreement: 'Agreement',
  tone: 'Tone',
};

const keyOf = (c: Pick<Correction, 'original' | 'replacement'>) =>
  `${c.original}\u0000${c.replacement}`;

/** Dismissed corrections, per chapter, in this browser: a deliberate spelling stays dismissed. */
function readDismissed(chapterId: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(`tc.proofread.dismissed.${chapterId}`);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeDismissed(chapterId: string, dismissed: Set<string>): void {
  try {
    window.localStorage.setItem(
      `tc.proofread.dismissed.${chapterId}`,
      JSON.stringify([...dismissed].slice(-200)),
    );
  } catch {
    // Private windows and blocked storage: the dismissal lasts for this page only, which is fine.
  }
}

/** The chapter's text as runs with positions, leaving out pending AI drafts (FR-4.10). */
function textRuns(editor: Editor): TextRun[] {
  const runs: TextRun[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'draftBlock') return false;
    if (node.isText && node.text) runs.push({ pos, text: node.text });
    return true;
  });
  return runs;
}

export function ProofreadPanel({
  chapterId,
  editor,
  save,
  onUsageChange,
  mode = 'proofread',
  documentId,
}: {
  chapterId: string;
  editor: Editor | null;
  /** Saves what is on screen first, so the chapter that is read is the one the student sees. */
  save: () => Promise<void>;
  onUsageChange: () => void;
  /** ADR-0084: 'tone' reviews the chapter against a sample instead of for mistakes. */
  mode?: Mode;
  /** For the tone mode's list of papers to use as the model. */
  documentId?: string;
}) {
  const [items, setItems] = useState<Correction[]>([]);
  const [progress, setProgress] = useState<Omit<RunResult, 'corrections'> | null>(null);
  const [checkedSoFar, setCheckedSoFar] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moved, setMoved] = useState<Set<string>>(new Set());
  /** R23 (ADR-0110): set after a run that found something, so the review opens in the text. */
  const [reviewAfterRun, setReviewAfterRun] = useState(0);
  /** ADR-0084: the tone mode's model — the student's own profile, or a library paper by id. */
  const [sampleSourceId, setSampleSourceId] = useState<string>('');
  const [samples, setSamples] = useState<SampleOption[]>([]);
  const [sampleLabel, setSampleLabel] = useState<string | null>(null);
  useEffect(() => {
    if (mode !== 'tone' || !documentId) return;
    void api<Array<{ id: string; title: string | null; groundingLevel?: string }>>(
      `/documents/${documentId}/sources`,
    )
      .then((list) =>
        setSamples(
          list
            .filter((s) => s.groundingLevel === 'FULL_TEXT' || s.groundingLevel === 'ABSTRACT')
            .map((s) => ({ id: s.id, title: s.title ?? 'Untitled paper' })),
        ),
      )
      .catch(() => setSamples([]));
  }, [mode, documentId]);

  // A different chapter is a different list.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the chapter changes
  useEffect(() => {
    setItems([]);
    setProgress(null);
    setCheckedSoFar(0);
    setError(null);
    setMoved(new Set());
  }, [chapterId]);

  const run = useCallback(
    async (fromSentence: number) => {
      setBusy(true);
      setError(null);
      try {
        await save();
        const result = await api<RunResult & { sample?: { label: string } }>(
          mode === 'tone' ? '/tone-review' : '/proofread',
          {
            method: 'POST',
            body: JSON.stringify({
              chapterId,
              ...(fromSentence > 0 ? { fromSentence } : {}),
              ...(mode === 'tone' && sampleSourceId ? { sampleSourceId } : {}),
            }),
          },
        );
        if (result.sample) setSampleLabel(result.sample.label);
        onUsageChange();
        const dismissed = readDismissed(chapterId);
        const fresh = result.corrections.filter((c) => !dismissed.has(keyOf(c)));
        setItems((current) => (fromSentence > 0 ? [...current, ...fresh] : fresh));
        setCheckedSoFar((n) => (fromSentence > 0 ? n : 0) + result.checkedWords);
        setProgress({
          checkedWords: result.checkedWords,
          totalWords: result.totalWords,
          refused: result.refused,
          nextSentence: result.nextSentence,
        });
        if (fromSentence === 0) setMoved(new Set());
        if (fresh.length > 0) setReviewAfterRun((n) => n + 1);
      } catch (e) {
        setError(
          e instanceof ApiError
            ? (e.problem.detail ?? e.problem.title)
            : 'The proofread did not run. Try again in a minute.',
        );
      } finally {
        setBusy(false);
      }
    },
    [chapterId, save, onUsageChange, mode, sampleSourceId],
  );

  const idOf = (c: Correction) => `${c.sentenceId}:${keyOf(c)}`;

  function place(c: Correction): { from: number; to: number } | null {
    if (!editor) return null;
    const span = locateSpan(textRuns(editor), c.original, c.near);
    if (!span) setMoved((m) => new Set(m).add(idOf(c)));
    return span;
  }

  function accept(c: Correction) {
    if (!editor) return;
    const span = place(c);
    if (!span) return;
    const end = span.from + c.replacement.length;
    // `insertText` keeps the span's own marks, so bold stays bold. The words are the proofreader's
    // now, so FR-4.11 provenance says COMMAND — through the extension's own command, which also
    // stops the provenance plugin re-reading the edit as the student's typing.
    let chain = editor
      .chain()
      .focus()
      .command(({ tr, dispatch }) => {
        if (dispatch) tr.insertText(c.replacement, span.from, span.to);
        return true;
      });
    if (end > span.from) {
      chain = chain.setProvenance(span.from, end, { kind: 'COMMAND', actionId: null });
    }
    // R23: taken from the list, so no longer shown in the text if a review is open.
    chain.removeTrackedChange(idOf(c)).run();
    setItems((list) => list.filter((x) => idOf(x) !== idOf(c)));
  }

  /**
   * Accept every correction still listed, in one step that one Undo takes back (2026-10-04, from
   * the Jenni study: "Accept all"). Still the student's explicit action on corrections they can
   * read above; a correction whose words have gone is skipped and stays listed.
   */
  function acceptAll() {
    if (!editor) return;
    const placed: Array<{ c: Correction; from: number; to: number }> = [];
    for (const c of items) {
      const span = place(c);
      if (span) placed.push({ c, ...span });
    }
    // Last first, so each edit leaves the positions before it untouched; overlapping spans are
    // left for a second pass rather than guessed at.
    placed.sort((a, b) => b.from - a.from);
    const applied: typeof placed = [];
    let floor = Number.POSITIVE_INFINITY;
    for (const p of placed) {
      if (p.to > floor) continue;
      applied.push(p);
      floor = p.from;
    }
    if (applied.length === 0) return;
    let chain = editor.chain().focus();
    for (const { c, from, to } of applied) {
      chain = chain.command(({ tr, dispatch }) => {
        if (dispatch) tr.insertText(c.replacement, from, to);
        return true;
      });
      if (c.replacement.length > 0) {
        chain = chain.setProvenance(from, from + c.replacement.length, {
          kind: 'COMMAND',
          actionId: null,
        });
      }
    }
    for (const { c } of applied) chain = chain.removeTrackedChange(idOf(c));
    chain.run();
    const done = new Set(applied.map((p) => idOf(p.c)));
    setItems((list) => list.filter((x) => !done.has(idOf(x))));
  }

  function dismiss(c: Correction) {
    const dismissed = readDismissed(chapterId);
    dismissed.add(keyOf(c));
    writeDismissed(chapterId, dismissed);
    for (const x of items) {
      if (keyOf(x) === keyOf(c)) editor?.commands.removeTrackedChange(idOf(x));
    }
    setItems((list) => list.filter((x) => keyOf(x) !== keyOf(c)));
  }

  /**
   * R23 (ADR-0110): the corrections as tracked changes in the chapter, walked through with Y and
   * N. Accepting there changes the text as Accept here does; this list follows each decision.
   */
  function reviewInText(list: Correction[]) {
    if (!editor) return;
    const byId = new Map(list.map((c) => [idOf(c), c]));
    const placed: ReviewItem[] = [];
    for (const c of list) {
      const span = place(c);
      if (!span) continue;
      placed.push({
        id: idOf(c),
        ...span,
        original: c.original,
        replacement: c.replacement,
        label: KIND_LABEL[c.kind] ?? c.kind,
        why: c.why,
      });
    }
    if (placed.length === 0) return;
    startReview({
      title: mode === 'tone' ? 'Tone of voice' : 'Spelling and grammar',
      items: placed,
      decide: (id, accepted) => {
        const c = byId.get(id);
        if (!c) return;
        // Accepted: the text is already changed. Rejected: remembered, as Dismiss is.
        if (accepted) setItems((current) => current.filter((x) => idOf(x) !== id));
        else dismiss(c);
      },
      rerun: {
        label: mode === 'tone' ? 'Review the tone again' : 'Proofread again',
        run: () => void run(0),
      },
      next:
        mode === 'tone'
          ? { label: 'Coherence check', open: () => openCheck('run-coherence') }
          : { label: 'Tone of voice', open: () => openCheck('tone-run') },
    });
  }

  // After a run that found something, straight into the text, as Jenni opens its reviews.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new run opens it
  useEffect(() => {
    if (reviewAfterRun > 0) reviewInText(items);
  }, [reviewAfterRun]);

  function show(c: Correction) {
    const span = place(c);
    if (span && editor) {
      editor.chain().focus().setTextSelection(span).scrollIntoView().run();
    }
  }

  const remaining = progress ? Math.max(0, progress.totalWords - checkedSoFar) : 0;

  return (
    <section
      className="mt-4 border-t border-line pt-3"
      data-testid={mode === 'tone' ? 'tone-panel' : 'proofread-panel'}
      data-mode={mode}
    >
      <p className="eyebrow">{mode === 'tone' ? 'Tone of voice' : 'Spelling and grammar'}</p>
      <p className="mt-1 text-xs text-muted">
        {mode === 'tone'
          ? 'Reads this chapter against the tone you want — your own writing profile, or a paper from your library — and offers a rewrite where a sentence clearly differs. Nothing changes until you accept one. One command unit a run, up to 2,000 words.'
          : 'Reads this chapter for spelling, grammar and punctuation mistakes. Each correction is shown to you, and nothing changes until you accept it. One command unit a run, up to 2,000 words.'}
      </p>
      {mode === 'tone' ? (
        <label className="mt-2 flex items-center gap-2 text-xs">
          <span className="text-muted">Match</span>
          <select
            data-testid="tone-sample"
            value={sampleSourceId}
            onChange={(e) => setSampleSourceId(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 text-xs"
          >
            <option value="">my own writing profile</option>
            {samples.map((s) => (
              <option key={s.id} value={s.id}>
                the paper: {s.title.length > 60 ? `${s.title.slice(0, 60)}…` : s.title}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <button
        type="button"
        disabled={busy || !editor}
        onClick={() => void run(0)}
        data-testid={mode === 'tone' ? 'tone-run' : 'proofread-run'}
        className="mt-2 rounded-md border border-line-strong bg-surface px-3 py-1 text-xs font-semibold text-ink transition-colors hover:bg-sunk disabled:opacity-50"
      >
        {busy
          ? 'Reading…'
          : mode === 'tone'
            ? progress
              ? 'Review the tone again'
              : 'Review the tone'
            : progress
              ? 'Proofread again'
              : 'Proofread this chapter'}
      </button>

      {error ? (
        <p role="alert" className="mt-2 text-xs text-warn">
          {error}
        </p>
      ) : null}

      {progress ? (
        <p className="mt-2 text-xs text-muted" data-testid="proofread-summary">
          {mode === 'tone'
            ? items.length === 0
              ? `Nothing out of tone in ${checkedSoFar.toLocaleString()} words${sampleLabel ? `, compared with ${sampleLabel}` : ''}.`
              : `${items.length} sentence${items.length === 1 ? '' : 's'} out of tone in ${checkedSoFar.toLocaleString()} words${sampleLabel ? `, compared with ${sampleLabel}` : ''}.`
            : items.length === 0
              ? `No mistakes found in ${checkedSoFar.toLocaleString()} words.`
              : `${items.length} correction${items.length === 1 ? '' : 's'} in ${checkedSoFar.toLocaleString()} words.`}
          {progress.nextSentence !== null && remaining > 0 ? (
            <>
              {' '}
              {remaining.toLocaleString()} words are still unread.{' '}
              <button
                type="button"
                disabled={busy}
                className="underline disabled:opacity-50"
                data-testid="proofread-continue"
                onClick={() => void run(progress.nextSentence ?? 0)}
              >
                Read the next part
              </button>{' '}
              (one more unit)
            </>
          ) : null}
        </p>
      ) : null}

      {items.length > 0 ? (
        <button
          type="button"
          disabled={!editor}
          data-testid={mode === 'tone' ? 'tone-review-in-text' : 'proofread-review-in-text'}
          onClick={() => reviewInText(items)}
          className="mt-2 block text-xs font-semibold text-accent underline disabled:opacity-50"
        >
          Review in the text ({items.length})
        </button>
      ) : null}

      {items.length > 1 ? (
        <p className="mt-2 flex flex-wrap items-center gap-3 text-xs">
          <button
            type="button"
            disabled={!editor}
            data-testid="proofread-accept-all"
            onClick={acceptAll}
            className="rounded-md border border-line-strong bg-surface px-2 py-0.5 font-semibold text-ink hover:bg-sunk disabled:opacity-50"
          >
            Accept all {items.length}
          </button>
          <span className="text-muted">
            One Undo takes them all back. Or Tab to one and press Y to accept, N to dismiss.
          </span>
        </p>
      ) : null}

      {items.length > 0 ? (
        <ul className="mt-2 grid list-none gap-2 p-0" data-testid="proofread-corrections">
          {items.map((c) => {
            const id = idOf(c);
            const gone = moved.has(id);
            return (
              <li
                key={id}
                data-testid="proofread-correction"
                // biome-ignore lint/a11y/noNoninteractiveTabindex: a focusable row for Y / N review
                tabIndex={0}
                aria-label={`${KIND_LABEL[c.kind] ?? c.kind}: ${c.original} to ${c.replacement}. Y to accept, N to dismiss.`}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  const key = e.key.toLowerCase();
                  if (key === 'y' && !gone) {
                    e.preventDefault();
                    accept(c);
                  } else if (key === 'n') {
                    e.preventDefault();
                    dismiss(c);
                  }
                }}
                className="rounded-md border border-line bg-surface p-2 text-xs focus:outline focus:outline-2 focus:outline-accent"
              >
                <p className="font-medium text-ink">{KIND_LABEL[c.kind] ?? c.kind}</p>
                <p className="mt-1">
                  <del className="text-warn">{c.original}</del>
                  {' → '}
                  <ins className="font-semibold text-ok no-underline">{c.replacement}</ins>
                </p>
                {c.why ? <p className="mt-1 text-muted">{c.why}</p> : null}
                <p className="mt-1 text-faint">
                  {c.sentence.length > 160 ? `${c.sentence.slice(0, 160)}…` : c.sentence}
                </p>
                {gone ? (
                  <p className="mt-1 text-warn" data-testid="proofread-moved">
                    Those words are no longer there. Proofread again to check the new text.
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={gone || !editor}
                    className="underline disabled:opacity-50"
                    data-testid="proofread-accept"
                    onClick={() => accept(c)}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    className="underline"
                    data-testid="proofread-dismiss"
                    onClick={() => dismiss(c)}
                  >
                    Dismiss
                  </button>
                  {gone ? null : (
                    <button type="button" className="underline" onClick={() => show(c)}>
                      Show me
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
