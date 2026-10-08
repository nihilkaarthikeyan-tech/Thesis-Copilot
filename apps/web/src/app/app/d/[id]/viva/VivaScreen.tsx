'use client';

/**
 * `/app/d/:id/viva` — viva preparation (ADR-0030).
 *
 * Questions an examiner could fairly ask about this thesis, each about a paragraph the student
 * wrote, and feedback on the answers they type. It coaches: the feedback says what an answer is
 * missing and never writes it, because the viva is the student's to give. Nothing here changes
 * the thesis.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { RateThis, type RunRating } from '@/components/RateThis';
import { Badge } from '@/components/ui/primitives';
import { ApiError, api } from '@/lib/api';

type Feedback = {
  verdict: 'strong' | 'partial' | 'weak';
  strengths: string[];
  gaps: string[];
  thesisSays: Array<{ quote: string; chapterTitle: string }>;
  followUp: string;
};

type Question = {
  id: string;
  order: number;
  kind: string;
  question: string;
  probing: string;
  chapterId: string;
  chapterTitle: string;
  passage: string;
  from?: number;
  to?: number;
  answer: string | null;
  feedback: Feedback | null;
  answeredAt: string | null;
};

type View = {
  setId: string | null;
  createdAt: string | null;
  questions: Question[];
  /** R36 (ADR-0115): the student's thumbs on this question set, if given. */
  rating?: RunRating;
};
type Usage = { actions: Array<{ action: string; used: number; cap: number; remaining: number }> };

const VERDICT = {
  strong: { tone: 'ok', label: 'Strong answer' },
  partial: { tone: 'warn', label: 'Partly there' },
  weak: { tone: 'danger', label: 'Needs work' },
} as const;

const problem = (e: unknown, fallback: string) =>
  e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : fallback;

export function VivaScreen({ documentId }: { documentId: string }) {
  const [view, setView] = useState<View | null>(null);
  const [title, setTitle] = useState('');
  const [left, setLeft] = useState<{ remaining: number; cap: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshUsage = useCallback(async () => {
    try {
      const usage = await api<Usage>('/usage/me');
      const viva = usage.actions.find((a) => a.action === 'VIVA');
      setLeft(viva ? { remaining: viva.remaining, cap: viva.cap } : null);
    } catch {
      // The meter is a convenience; the server enforces the cap either way.
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [next, doc] = await Promise.all([
          api<View>(`/documents/${documentId}/viva`),
          api<{ title: string }>(`/documents/${documentId}`),
        ]);
        setView(next);
        setTitle(doc.title);
      } catch (e) {
        setError(problem(e, 'Could not load viva preparation.'));
      }
    })();
    void refreshUsage();
  }, [documentId, refreshUsage]);

  const ask = async () => {
    setBusy(true);
    setError(null);
    try {
      setView(
        await api<View>(`/viva/${documentId}/questions`, {
          method: 'POST',
          body: JSON.stringify({}),
        }),
      );
    } catch (e) {
      setError(problem(e, 'Could not ask for questions. Nothing was charged.'));
    } finally {
      setBusy(false);
      void refreshUsage();
    }
  };

  const answered = (updated: Question) => {
    setView((current) =>
      current
        ? {
            ...current,
            questions: current.questions.map((q) => (q.id === updated.id ? updated : q)),
          }
        : current,
    );
    void refreshUsage();
  };

  const questions = view?.questions ?? [];
  const done = questions.filter((q) => q.feedback).length;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <nav className="text-xs text-muted">
        <Link href="/app" className="hover:underline">
          Theses
        </Link>{' '}
        / Viva preparation
      </nav>
      <h1 className="mt-2 text-balance text-[28px] font-bold leading-tight tracking-[-0.02em] text-ink">
        Prepare for your viva
        {title ? <span className="block text-base text-muted">{title}</span> : null}
      </h1>

      <section className="mt-6 rounded-md border border-line bg-surface p-4 text-sm">
        <p>
          Questions an examiner could fairly ask about <em>your</em> thesis, each about a paragraph
          you wrote. Answer one as you would aloud, type what you said, and get feedback on what an
          examiner would find missing. It will not write your answers — the viva is yours to give.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void ask()}
            disabled={busy || left?.remaining === 0}
            data-testid="viva-ask"
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-50"
          >
            {busy
              ? 'Reading your thesis…'
              : view?.setId
                ? 'Ask me new questions'
                : 'Ask me questions'}
          </button>
          <span className="text-xs text-muted" data-testid="viva-left">
            {left
              ? `${left.remaining} of ${left.cap} viva uses left this month · a question set or one answer’s feedback is one use`
              : 'A question set or one answer’s feedback is one use'}
          </span>
        </div>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-warn">
            {error}
          </p>
        ) : null}
      </section>

      {questions.length > 0 ? (
        <section className="mt-6">
          <h2 className="eyebrow">
            {questions.length} questions · {done} answered
          </h2>
          <ol className="mt-3 space-y-4" data-testid="viva-questions">
            {questions.map((q) => (
              <QuestionCard
                key={q.id}
                documentId={documentId}
                question={q}
                noneLeft={left?.remaining === 0}
                onAnswered={answered}
              />
            ))}
          </ol>
          {/* R36 (ADR-0115): after the set, on the set; keyed by it, so a new set starts unrated. */}
          {view?.setId ? (
            <RateThis
              key={view.setId}
              className="mt-4"
              documentId={documentId}
              kind="viva"
              runId={view.setId}
              initial={view.rating ?? null}
              question="How were these questions?"
            />
          ) : null}
        </section>
      ) : view && !busy ? (
        <p className="mt-6 text-sm text-muted">
          No questions yet. They are written from paragraphs across all your chapters, so the more
          of the thesis there is, the better they get.
        </p>
      ) : null}
    </main>
  );
}

function QuestionCard({
  documentId,
  question,
  noneLeft,
  onAnswered,
}: {
  documentId: string;
  question: Question;
  noneLeft: boolean;
  onAnswered: (q: Question) => void;
}) {
  const [draft, setDraft] = useState(question.answer ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showProbe, setShowProbe] = useState(false);
  const feedback = question.feedback;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onAnswered(
        await api<Question>(`/viva/questions/${question.id}/answer`, {
          method: 'POST',
          body: JSON.stringify({ answer: draft }),
        }),
      );
    } catch (e) {
      setError(problem(e, 'Could not get feedback. Nothing was charged.'));
    } finally {
      setBusy(false);
    }
  };

  const where =
    question.from !== undefined && question.to !== undefined
      ? `/app/d/${documentId}/write/${question.chapterId}?from=${question.from}&to=${question.to}`
      : `/app/d/${documentId}/write/${question.chapterId}`;

  return (
    <li
      className="rounded-md border border-line bg-surface p-4 text-sm"
      data-testid="viva-question"
    >
      <p className="flex flex-wrap items-center gap-2 text-xs text-faint">
        <Badge tone="accent">{question.kind}</Badge>
        <span>{question.chapterTitle}</span>
        <Link href={where} className="text-accent hover:underline">
          See the paragraph →
        </Link>
      </p>
      <p className="mt-2 font-serif text-[17px] leading-snug text-ink">{question.question}</p>
      <button
        type="button"
        onClick={() => setShowProbe((v) => !v)}
        className="mt-1 text-xs text-muted underline"
      >
        {showProbe ? 'Hide' : 'What is this testing?'}
      </button>
      {showProbe ? <p className="mt-1 text-xs text-muted">{question.probing}</p> : null}

      <label className="mt-3 block text-xs text-muted" htmlFor={`answer-${question.id}`}>
        Your answer, as you would say it
      </label>
      <textarea
        id={`answer-${question.id}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={4}
        maxLength={4000}
        data-testid="viva-answer"
        className="mt-1 w-full rounded-md border border-line bg-paper p-2 text-sm text-ink"
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || noneLeft || draft.trim().split(/\s+/).filter(Boolean).length < 5}
          data-testid="viva-submit"
          className="rounded-md border border-line-strong px-3 py-1.5 text-xs font-semibold text-ink hover:bg-sunk disabled:opacity-50"
        >
          {busy ? 'Listening…' : feedback ? 'Get feedback on this version' : 'Get feedback'}
        </button>
        {error ? (
          <span role="alert" className="text-xs text-warn">
            {error}
          </span>
        ) : null}
      </div>

      {feedback ? (
        <div className="mt-4 border-t border-line pt-3" data-testid="viva-feedback">
          <Badge tone={VERDICT[feedback.verdict].tone}>{VERDICT[feedback.verdict].label}</Badge>
          {feedback.strengths.length > 0 ? (
            <>
              <p className="mt-2 text-xs font-semibold text-ok">What worked</p>
              <ul className="ml-4 list-disc text-sm">
                {feedback.strengths.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </>
          ) : null}
          {feedback.gaps.length > 0 ? (
            <>
              <p className="mt-2 text-xs font-semibold text-warn">What an examiner would miss</p>
              <ul className="ml-4 list-disc text-sm">
                {feedback.gaps.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            </>
          ) : null}
          {feedback.thesisSays.length > 0 ? (
            <>
              <p className="mt-2 text-xs font-semibold text-muted">Your thesis says</p>
              {feedback.thesisSays.map((said) => (
                <blockquote
                  key={said.quote}
                  className="mt-1 border-l-2 border-line-strong pl-3 text-sm italic"
                >
                  “{said.quote}”{' '}
                  <span className="not-italic text-xs text-faint">— {said.chapterTitle}</span>
                </blockquote>
              ))}
            </>
          ) : null}
          {feedback.followUp ? (
            <p className="mt-3 text-sm">
              <span className="text-xs font-semibold text-muted">They might ask next: </span>
              {feedback.followUp}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
