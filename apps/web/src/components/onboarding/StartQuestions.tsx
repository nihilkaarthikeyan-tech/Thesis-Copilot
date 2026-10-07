'use client';

/**
 * Jenni build plan R4 (ADR-0091): a few questions at the start, each with answers the AI suggests.
 *
 * The owner: "we need to ask the prompts like questions, 3–4, from the user, and the AI must give
 * the suggestion; they can take it or not." Our proposal conversation (A.6, evaluated) already
 * does this — up to three questions, each with 2–4 options to tap or "something else" — but only
 * the "with a proposal" path reached it. This puts it in the Start writing now path, after the
 * thesis is made with Smart headings: the answers become the proposal, and the chapters are
 * planned from it instead of from the title alone. Skipping plans from the title, as before.
 */

import { useState } from 'react';
import { PathAChat, type ProposalView } from '@/components/proposal/PathAChat';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/primitives';
import { ApiError, api } from '@/lib/api';

type Skeleton = NonNullable<ProposalView['skeleton']>;

export function StartQuestions(props: {
  documentId: string;
  title: string;
  /** Where to go when the chapters are on their way. */
  onDone: () => void;
}) {
  const [skeleton, setSkeleton] = useState<Skeleton | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const problem = (e: unknown, fallback: string) =>
    e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : fallback;

  /** The answers, as the thesis's proposal; the chapters are planned from it. */
  async function applyAnswers() {
    if (!skeleton) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/documents/${props.documentId}/memory/scope`, {
        method: 'PUT',
        body: JSON.stringify(skeleton),
      });
      await api(`/documents/${props.documentId}/outline/generate`, {
        method: 'POST',
        body: '{}',
      }).catch(() => undefined);
      props.onDone();
    } catch (e) {
      setError(problem(e, 'Your answers could not be saved. Try again, or skip.'));
      setBusy(false);
    }
  }

  /** No answers: the chapters are planned from the title, as before (ADR-0087). */
  async function skip() {
    setBusy(true);
    await api(`/documents/${props.documentId}/outline/plan-from-title`, {
      method: 'POST',
      body: '{}',
    }).catch(() => undefined);
    props.onDone();
  }

  return (
    <section className="rounded-md border border-line p-4" data-testid="start-questions">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[14px] font-semibold text-ink">
            A few quick questions, so your chapters fit your thesis
          </p>
          <Hint className="mt-0.5">
            Tap a suggested answer, type your own, or skip. Up to three questions.
          </Hint>
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={() => void skip()}
          data-testid="start-questions-skip"
        >
          Skip and start writing
        </Button>
      </div>

      <PathAChat
        documentId={props.documentId}
        initialTitle={props.title}
        autoStart
        onSkeleton={(view) => setSkeleton(view.skeleton)}
      />

      {skeleton ? (
        <div className="mt-4 rounded-md bg-sunk p-4" data-testid="start-questions-result">
          <p className="text-[13px] font-semibold text-muted">From your answers</p>
          <p className="mt-1 text-[15px] font-semibold text-ink">{skeleton.workingTitle}</p>
          <p className="mt-2 text-[13.5px] text-ink">{skeleton.problemStatement}</p>
          <ul className="mt-2 list-disc pl-5 text-[13.5px] text-ink">
            {skeleton.objectives.map((objective) => (
              <li key={objective}>{objective}</li>
            ))}
          </ul>
          <Hint className="mt-2">
            You can change any of this later on the Proposal page. Your chapters are planned from
            it.
          </Hint>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={busy}
              onClick={() => void applyAnswers()}
              data-testid="start-questions-use"
            >
              {busy ? 'Starting…' : 'Use this and start writing'}
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-xs text-warn">
          {error}
        </p>
      ) : null}
    </section>
  );
}
