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
import { ApiError, api } from '@/lib/api';

export type ProposalView = {
  visible: Array<{ role: 'user' | 'assistant'; text: string; at: string }>;
  gapCheck: {
    count: number;
    works: Array<{ title: string; year: number | null; abstract: string; doi?: string | null }>;
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
};

const CLOSEST = 5;

export function PathAChat({
  documentId,
  initialTitle,
  onSkeleton,
}: {
  documentId: string;
  /** The working title from `/app/new`, offered as the first message. */
  initialTitle: string;
  onSkeleton: (view: ProposalView) => void;
}) {
  const [view, setView] = useState<ProposalView | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<ProposalView>(`/documents/${documentId}/proposal`)
      .then((v) => {
        setView(v);
        if (v.visible.length === 0) setDraft(initialTitle);
        if (v.done) onSkeleton(v);
      })
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.problem.title : 'Could not load the conversation.'),
      );
  }, [documentId, initialTitle, onSkeleton]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [view?.visible.length]);

  async function send(event: FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || busy) return;
    setBusy(true);
    setError(null);
    // Show the student's line at once; the server's copy replaces it.
    setView((v) =>
      v
        ? {
            ...v,
            visible: [...v.visible, { role: 'user', text: message, at: new Date().toISOString() }],
          }
        : v,
    );
    setDraft('');
    try {
      const next = await api<ProposalView>(`/documents/${documentId}/proposal`, {
        method: 'POST',
        body: JSON.stringify({ message }),
      });
      setView(next);
      if (next.done) onSkeleton(next);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? (e.problem.detail ?? e.problem.title)
          : 'That did not send. Try again.',
      );
      setDraft(message);
    } finally {
      setBusy(false);
    }
  }

  if (!view) return <p className="mt-8 text-sm text-muted">Loading…</p>;

  return (
    <section className="mt-8 grid gap-6 lg:grid-cols-[1.4fr_1fr]" data-testid="path-a-chat">
      <div className="rounded-lg border border-line bg-white">
        <div className="max-h-[28rem] space-y-3 overflow-y-auto p-4" aria-live="polite">
          {view.visible.length === 0 ? (
            <p className="text-sm text-muted">
              Describe the topic in a sentence or two. You will be asked{' '}
              {view.maxQuestions === 1 ? 'one question' : `up to ${view.maxQuestions} questions`}{' '}
              before a proposal skeleton is drafted — and you edit every word of it.
            </p>
          ) : null}
          {view.visible.map((m, i) => (
            <div
              key={`${m.at}-${i}`}
              data-role={m.role}
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                m.role === 'user' ? 'ml-auto bg-ink text-white' : 'bg-paper'
              }`}
            >
              {m.text}
            </div>
          ))}
          {busy ? <p className="text-xs text-muted">Thinking…</p> : null}
          <div ref={endRef} />
        </div>
        {!view.done ? (
          <form onSubmit={send} className="flex gap-2 border-t border-line p-3">
            <label className="sr-only" htmlFor="path-a-message">
              Your message
            </label>
            <input
              id="path-a-message"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={busy}
              maxLength={2000}
              className="h-10 flex-1 rounded-md border border-line px-3 text-sm"
              placeholder={view.visible.length === 0 ? 'Your topic…' : 'Your answer…'}
            />
            <button
              type="submit"
              disabled={busy || draft.trim().length === 0}
              className="rounded-md bg-ink px-4 text-sm text-white disabled:opacity-50"
            >
              Send
            </button>
          </form>
        ) : null}
        <p className="border-t border-line px-3 py-2 text-xs text-muted">
          {view.questionsAsked} of {view.maxQuestions} questions asked
          {view.done ? ' · skeleton ready below' : ''}
        </p>
        {error ? (
          <p role="alert" className="px-3 pb-3 text-sm text-warn">
            {error}
          </p>
        ) : null}
      </div>

      <aside className="rounded-lg border border-line bg-paper p-4 text-sm" data-testid="gap-check">
        <p className="text-xs uppercase tracking-wide text-muted">Related work</p>
        {view.gapCheck ? (
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
          <p className="mt-1 text-muted">Appears after your first answer.</p>
        )}
      </aside>
    </section>
  );
}
