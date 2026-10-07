'use client';

/**
 * Path A conversation — PRD FR-1.5, PHASES 6.1.
 *
 *   "Chat-style UI, not a form." … "gap-check results are shown as 'N related works found;
 *    closest 5'."
 *
 * The server owns the state (`Document.meta.proposalChat`); this shows it and sends one message
 * at a time. When the skeleton arrives the parent swaps in the same editable form Path B uses.
 */

import { type FormEvent, useEffect, useRef, useState } from 'react';
import { tNow } from '@/i18n';
import { useT } from '@/i18n/react';
import { ApiError, api } from '@/lib/api';
import { questionOptions } from '@/lib/question-options';
import { EXAMPLE_TOPICS } from '@/lib/topic-strength';
import { TopicMeter } from './TopicMeter';

export type ProposalView = {
  visible: Array<{ role: 'user' | 'assistant'; text: string; at: string }>;
  gapCheck: {
    count: number;
    works: Array<{ title: string; year: number | null; abstract: string; doi?: string | null }>;
    /** The search could not run; absent on conversations stored before it was recorded. */
    failed?: boolean;
  } | null;
  skeleton: {
    workingTitle: string;
    problemStatement: string;
    objectives: string[];
    whyOpen: string;
  } | null;
  questionsAsked: number;
  maxQuestions: number;
  done: boolean;
  /** Model turns left on this conversation; an earlier answer can be changed while any remain. */
  turnsLeft?: number;
};

const CLOSEST = 5;
/** How long each example topic stays in the empty box before the next one. */
const EXAMPLE_MS = 4000;

export function PathAChat({
  documentId,
  initialTitle,
  onSkeleton,
  autoStart = false,
}: {
  documentId: string;
  /** The working title from `/app/new`, offered as the first message. */
  initialTitle: string;
  onSkeleton: (view: ProposalView, replace?: boolean) => void;
  /**
   * Jenni build plan R4: send the title as the first message at once, so the first question is
   * already on its way when the start step opens (the student typed the title a moment ago).
   */
  autoStart?: boolean;
}) {
  const { t } = useT();
  const [view, setView] = useState<ProposalView | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** Which example topic the empty first-message box shows (coverage-map row 3). */
  const [example, setExample] = useState(0);
  /**
   * Changing an earlier answer (2026-10-04, from the Jenni study): the index, in `visible`, of the
   * answer being replaced. Everything after it is redrafted from the new answer.
   */
  const [editing, setEditing] = useState<number | null>(null);

  useEffect(() => {
    api<ProposalView>(`/documents/${documentId}/proposal`)
      .then((v) => {
        setView(v);
        if (v.visible.length === 0) setDraft(initialTitle);
        if (v.done) onSkeleton(v);
      })
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.problem.title : tNow('pathA.loadError')),
      );
  }, [documentId, initialTitle, onSkeleton]);

  const shown = view?.visible.length ?? 0;
  const firstMessage = view !== null && !view.done && shown === 0;
  // The examples rotate only while the box is empty and nothing has been sent.
  const rotate = firstMessage && draft.length === 0;
  useEffect(() => {
    if (!rotate) return;
    const timer = setInterval(() => setExample((n) => (n + 1) % EXAMPLE_TOPICS.length), EXAMPLE_MS);
    return () => clearInterval(timer);
  }, [rotate]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the list grows
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [shown]);

  const autoStarted = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, when the empty view arrives
  useEffect(() => {
    if (!autoStart || autoStarted.current || !view || view.visible.length > 0) return;
    if (!initialTitle.trim()) return;
    autoStarted.current = true;
    void send(initialTitle);
  }, [autoStart, view]);

  function submit(event: FormEvent) {
    event.preventDefault();
    void send(draft);
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    const editIndex = editing;
    setBusy(true);
    setError(null);
    // Show the student's line at once; the server's copy replaces it.
    setView((v) =>
      v
        ? {
            ...v,
            visible: [
              ...(editIndex === null ? v.visible : v.visible.slice(0, editIndex)),
              { role: 'user', text: message, at: new Date().toISOString() },
            ],
          }
        : v,
    );
    setDraft('');
    try {
      const next = await api<ProposalView>(`/documents/${documentId}/proposal`, {
        method: 'POST',
        body: JSON.stringify({ message, ...(editIndex === null ? {} : { editIndex }) }),
      });
      setEditing(null);
      setView(next);
      if (next.done) onSkeleton(next, editIndex !== null);
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : tNow('pathA.sendError'),
      );
      setDraft(message);
      // The server kept the old conversation; show it again rather than the optimistic one.
      if (editIndex !== null) {
        api<ProposalView>(`/documents/${documentId}/proposal`)
          .then(setView)
          .catch(() => undefined);
      }
    } finally {
      setBusy(false);
    }
  }

  if (!view) return <p className="mt-8 text-sm text-muted">{t('common.loading')}</p>;

  // The question being answered offers its options as buttons (docs/JENNI-FIX-LIST.md item 14).
  const last = view.visible.at(-1);
  const options =
    !view.done && editing === null && last?.role === 'assistant' ? questionOptions(last.text) : [];
  const canEdit = !busy && (view.turnsLeft ?? 0) > 0;

  return (
    <section className="mt-8 grid gap-6 lg:grid-cols-[1.4fr_1fr]" data-testid="path-a-chat">
      <div className="rounded-md border border-line bg-surface">
        <div className="max-h-[28rem] space-y-3 overflow-y-auto p-4" aria-live="polite">
          {view.visible.length === 0 ? (
            <p className="text-sm text-muted">
              {view.maxQuestions === 1
                ? t('pathA.introOne')
                : t('pathA.introMany', { n: view.maxQuestions })}
            </p>
          ) : null}
          {view.visible.map((m, index) => (
            <div
              key={`${m.role}-${m.at}-${m.text}`}
              className={m.role === 'user' ? 'flex flex-col items-end' : undefined}
            >
              <div
                data-role={m.role}
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                  m.role === 'user' ? 'bg-accent text-accent-ink' : 'bg-paper'
                } ${editing === index ? 'opacity-60' : ''}`}
              >
                {m.text}
              </div>
              {m.role === 'user' && canEdit ? (
                <button
                  type="button"
                  data-testid="edit-answer"
                  onClick={() => {
                    setEditing(index);
                    setDraft(m.text);
                    inputRef.current?.focus();
                  }}
                  className="mt-0.5 text-xs text-muted underline"
                >
                  {t('common.edit')}
                </button>
              ) : null}
            </div>
          ))}
          {options.length > 0 && !busy ? (
            <fieldset className="flex flex-wrap gap-2" data-testid="question-options">
              <legend className="sr-only">{t('pathA.chooseAnswer')}</legend>
              {options.map((option) =>
                option.other ? (
                  <button
                    key={option.text}
                    type="button"
                    onClick={() => inputRef.current?.focus()}
                    className="rounded-full border border-line px-3 py-1.5 text-left text-sm text-muted hover:bg-paper"
                  >
                    {t('pathA.typeBelow', { option: option.text })}
                  </button>
                ) : (
                  <button
                    key={option.text}
                    type="button"
                    onClick={() => void send(option.text)}
                    className="rounded-full border border-accent px-3 py-1.5 text-left text-sm hover:bg-paper"
                  >
                    {option.text}
                  </button>
                ),
              )}
            </fieldset>
          ) : null}
          {busy ? <p className="text-xs text-muted">{t('pathA.thinking')}</p> : null}
          <div ref={endRef} />
        </div>
        {editing !== null ? (
          <p
            className="flex items-center justify-between gap-2 border-t border-line px-3 py-2 text-xs"
            data-testid="editing-answer"
          >
            <span>{view.done ? t('pathA.editingDone') : t('pathA.editing')}</span>
            <button
              type="button"
              className="underline"
              onClick={() => {
                setEditing(null);
                setDraft('');
              }}
            >
              {t('common.cancel')}
            </button>
          </p>
        ) : null}
        {!view.done || editing !== null ? (
          <form onSubmit={submit} className="flex gap-2 border-t border-line p-3">
            <label className="sr-only" htmlFor="path-a-message">
              {t('pathA.yourMessage')}
            </label>
            <input
              ref={inputRef}
              id="path-a-message"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={busy}
              maxLength={2000}
              className="h-10 flex-1 rounded-md border border-line px-3 text-sm"
              placeholder={
                view.visible.length === 0
                  ? t('pathA.examplePlaceholder', { example: EXAMPLE_TOPICS[example] ?? '' })
                  : options.length > 0
                    ? t('pathA.chooseOrType')
                    : t('pathA.yourAnswer')
              }
            />
            <button
              type="submit"
              disabled={busy || draft.trim().length === 0}
              className="rounded-md px-4 text-sm disabled:opacity-50 bg-accent text-accent-ink hover:bg-accent-hover font-semibold transition-colors"
            >
              {t('common.send')}
            </button>
          </form>
        ) : null}
        {firstMessage ? <TopicMeter text={draft} example={EXAMPLE_TOPICS[example]} /> : null}
        <p className="border-t border-line px-3 py-2 text-xs text-muted">
          {t('pathA.asked', { asked: view.questionsAsked, max: view.maxQuestions })}
          {view.done ? t('pathA.skeletonReady') : ''}
        </p>
        {error ? (
          <p role="alert" className="px-3 pb-3 text-sm text-warn">
            {error}
          </p>
        ) : null}
      </div>

      <aside className="rounded-md border border-line bg-paper p-4 text-sm" data-testid="gap-check">
        <p className="text-xs uppercase tracking-wide text-muted">{t('pathA.relatedWork')}</p>
        {view.gapCheck?.failed ? (
          <p className="mt-1">
            The related-work search could not run this time, so the proposal skeleton is drafted
            without it. This does not mean nothing has been written on your topic: find papers for
            it on the Sources page once the proposal is saved.
          </p>
        ) : view.gapCheck ? (
          <>
            <p className="mt-1 font-medium">
              {view.gapCheck.count.toLocaleString()} related work
              {view.gapCheck.count === 1 ? '' : 's'} found
              {view.gapCheck.works.length > 0
                ? `; closest ${Math.min(CLOSEST, view.gapCheck.works.length)}:`
                : '.'}
            </p>
            <ul className="mt-2 space-y-2">
              {view.gapCheck.works.slice(0, CLOSEST).map((w) => (
                <li key={`${w.title}-${w.year}`}>
                  <span className="font-medium">{w.title}</span>
                  {w.year ? <span className="text-muted"> ({w.year})</span> : null}
                  {w.abstract ? <p className="text-xs text-muted">{w.abstract}</p> : null}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted">
              From OpenAlex, on what you have said so far. It informs the “why this is open” note;
              nothing here enters your library unless you add it.
            </p>
          </>
        ) : (
          <p className="mt-1 text-muted">{t('pathA.appearsAfter')}</p>
        )}
      </aside>
    </section>
  );
}
