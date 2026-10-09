'use client';

/**
 * ADR-0145, the setup card's third row: today's start questions (ADR-0091, the evaluated A.6
 * proposal conversation) one at a time, each with the answers the AI suggests as buttons, or
 * "Skip — plan my chapters from the title". The same routes as `StartQuestions` and `PathAChat`:
 * `GET/POST /documents/:id/proposal`, then the answers saved as the proposal
 * (`PUT /memory/scope`) and the chapters planned from them (`POST /outline/generate`), or
 * `POST /outline/plan-from-title` on Skip. No new prompt and no new metered action.
 *
 * A refusal (an allowance used up) is said inside the card with the limit message (ADR-0122),
 * with "Start without a plan" kept.
 */

import type { SetupCard } from '@tc/types';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { LimitNotice, useLimit } from '@/components/LimitNotice';
import type { ProposalView } from '@/components/proposal/PathAChat';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n/react';
import { ApiError, api } from '@/lib/api';
import { questionOptions, questionStem } from '@/lib/question-options';

type Skeleton = NonNullable<ProposalView['skeleton']>;

function problem(e: unknown, fallback: string): string {
  return e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : fallback;
}

export function SetupAim({
  documentId,
  title,
  onPlanned,
  onNoPlan,
}: {
  documentId: string;
  title: string;
  /** The chapters are on their way, planned from the answers or from the title. */
  onPlanned: (aim: NonNullable<SetupCard['aim']>) => Promise<void>;
  /** A refusal, and the student chose to start with one chapter and no plan. */
  onNoPlan: () => Promise<void>;
}) {
  const { t } = useT();
  const [view, setView] = useState<ProposalView | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);
  /** Skip works while a question is still being written: it does not wait for it. */
  const [skipping, setSkipping] = useState(false);
  const limit = useLimit();
  const started = useRef(false);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    setError(null);
    limit.clear();
    setDraft('');
    try {
      const next = await api<ProposalView>(`/documents/${documentId}/proposal`, {
        method: 'POST',
        body: JSON.stringify({ message }),
      });
      setView(next);
    } catch (e) {
      if (!limit.take(e)) setError(problem(e, t('setup.aim.error')));
      else setRefused(true);
      setDraft(message === title ? '' : message);
    } finally {
      setBusy(false);
    }
  }

  /** The conversation so far; a new one starts with the title, as Start writing now's did. */
  async function load(live: () => boolean = () => true) {
    setError(null);
    try {
      const v = await api<ProposalView>(`/documents/${documentId}/proposal`);
      if (!live()) return;
      setView(v);
      if (v.visible.length === 0 && !started.current && title.trim()) {
        started.current = true;
        void send(title);
      }
    } catch (e) {
      if (live()) setError(problem(e, t('setup.aim.error')));
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: once, for this thesis.
  useEffect(() => {
    let live = true;
    void load(() => live);
    return () => {
      live = false;
    };
  }, [documentId]);

  /**
   * The first question did not come (a provider refusal, a time limit): say so in its place and
   * offer it again, rather than "Thinking of the first question…" over a shut answer box for good
   * (ADR-0145 addendum, found on real models 2026-10-09).
   */
  function retry() {
    if (!view) {
      started.current = false;
      void load();
    } else if (view.visible.length === 0) {
      void send(title);
    }
  }

  const skeleton: Skeleton | null = view?.done ? view.skeleton : null;
  /** The student's answer to the first question: the aim row's one-line summary. */
  const focus =
    view?.visible.filter((m) => m.role === 'user')[1]?.text.slice(0, 200) ??
    skeleton?.workingTitle.slice(0, 200) ??
    null;

  async function applyAnswers() {
    if (!skeleton) return;
    setBusy(true);
    setError(null);
    limit.clear();
    try {
      await api(`/documents/${documentId}/memory/scope`, {
        method: 'PUT',
        body: JSON.stringify(skeleton),
      });
      await api(`/documents/${documentId}/outline/generate`, { method: 'POST', body: '{}' });
      await onPlanned({ focus, objectives: skeleton.objectives.length, fromTitle: false });
    } catch (e) {
      if (limit.take(e)) setRefused(true);
      else setError(problem(e, t('setup.aim.error')));
      setBusy(false);
    }
  }

  async function skip() {
    started.current = true;
    setSkipping(true);
    setError(null);
    limit.clear();
    try {
      await api(`/documents/${documentId}/outline/plan-from-title`, {
        method: 'POST',
        body: '{}',
      });
      await onPlanned({ focus: null, objectives: 0, fromTitle: true });
    } catch (e) {
      setRefused(true);
      if (!limit.take(e)) setError(problem(e, t('setup.chapters.failed')));
      setSkipping(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void send(draft);
  }

  const last = view?.visible.at(-1);
  const asking = !view?.done && last?.role === 'assistant';
  const options = asking && !busy ? questionOptions(last.text) : [];
  const userTurns = view?.visible.filter((m) => m.role === 'user').length ?? 0;
  const firstFailed = !busy && !skipping && error !== null && (!view || view.visible.length === 0);

  return (
    <div data-testid="setup-aim" className="min-w-0">
      {skeleton ? (
        <div data-testid="setup-aim-result">
          <p className="text-[13px] font-semibold text-muted">{t('setup.aim.result')}</p>
          {/*
            Saving the answers makes their working title the thesis's title (FR-1.4), so it is
            shown before the student agrees to it, as StartQuestions showed it. Without this a
            real model's sharper title replaced the one typed in row 1 unseen (ADR-0145 addendum).
          */}
          {skeleton.workingTitle.trim() !== title.trim() ? (
            <p className="mt-1 text-[12.5px] text-muted" data-testid="setup-aim-title">
              {t('setup.aim.newTitle')}{' '}
              <span className="font-semibold text-ink [overflow-wrap:anywhere]">
                {skeleton.workingTitle}
              </span>
            </p>
          ) : null}
          <p className="mt-1 text-[14px] text-ink [overflow-wrap:anywhere]">
            {skeleton.problemStatement}
          </p>
          <p className="mt-1 text-[12.5px] text-muted">
            {t('setup.aim.objectives', { n: skeleton.objectives.length })}
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              disabled={busy}
              onClick={() => void applyAnswers()}
              data-testid="setup-aim-use"
            >
              {busy ? t('setup.saving') : t('setup.aim.use')}
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/*
            The question and its answers scroll together on a short screen, the answer box and
            Skip staying outside: a real A.6 question runs to eight lines at 360 px, or three
            lines and four long answers, and either pushed the chapter heading off an 800 px
            screen (ADR-0145 addendum). The mock's one-line question never did.
          */}
          <div
            data-testid="setup-aim-scroll"
            className="min-w-0 [@media(max-height:820px)]:max-h-[22vh] [@media(max-height:820px)]:overflow-y-auto [@media(max-height:820px)]:pr-1"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p
                className="min-w-0 flex-1 text-[14px] font-semibold text-ink [overflow-wrap:anywhere]"
                data-testid="setup-aim-question"
              >
                {asking && last
                  ? questionStem(last.text)
                  : firstFailed
                    ? t('setup.aim.failed')
                    : t('setup.aim.thinking')}
              </p>
              {view && asking ? (
                <span className="shrink-0 text-[12px] text-muted">
                  {t('setup.aim.count', {
                    n: Math.max(1, view.questionsAsked),
                    max: view.maxQuestions,
                  })}
                </span>
              ) : null}
            </div>
            {options.length > 0 ? (
              <fieldset className="mt-2 flex flex-col items-start gap-1.5 border-0 p-0">
                <legend className="sr-only">{t('pathA.chooseAnswer')}</legend>
                {options
                  .filter((o) => !o.other)
                  .map((option) => (
                    <button
                      key={option.text}
                      type="button"
                      onClick={() => void send(option.text)}
                      data-testid="setup-aim-option"
                      className="max-w-full rounded-full border border-accent/60 px-3 py-1 text-left text-[13px] text-ink hover:bg-accent-soft [overflow-wrap:anywhere]"
                    >
                      {option.text}
                    </button>
                  ))}
              </fieldset>
            ) : null}
          </div>
          {busy && userTurns > 0 ? (
            <p className="mt-2 text-[12px] text-muted" role="status">
              {t('pathA.thinking')}
            </p>
          ) : null}
          <form onSubmit={submit} className="mt-2 flex min-w-0 gap-2">
            <label className="sr-only" htmlFor="setup-aim-answer">
              {t('setup.aim.own')}
            </label>
            <input
              id="setup-aim-answer"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={busy || !asking}
              maxLength={2000}
              placeholder={t('setup.aim.own')}
              className="h-9 min-w-0 flex-1 rounded-md border border-line bg-paper px-3 text-[13px]"
            />
            <Button type="submit" disabled={busy || draft.trim().length === 0}>
              {t('common.send')}
            </Button>
          </form>
        </>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        {firstFailed && !refused ? (
          <Button type="button" variant="secondary" onClick={retry} data-testid="setup-aim-retry">
            {t('setup.aim.retry')}
          </Button>
        ) : null}
        <button
          type="button"
          disabled={skipping}
          onClick={() => void skip()}
          data-testid="setup-aim-skip"
          className="text-[12.5px] text-muted underline underline-offset-2 hover:text-ink disabled:opacity-60"
        >
          {t('setup.aim.skip')}
        </button>
      </div>
      <LimitNotice limit={limit.value} className="mt-2" />
      {error ? (
        <p role="alert" className="mt-2 text-[12.5px] text-warn">
          {error}
        </p>
      ) : null}
      {refused ? (
        <div className="mt-2">
          <p className="text-[12.5px] text-muted">{t('setup.aim.noPlanHint')}</p>
          <Button
            type="button"
            variant="secondary"
            className="mt-1.5"
            disabled={busy}
            onClick={() => void onNoPlan()}
            data-testid="setup-no-plan"
          >
            {t('setup.aim.noPlan')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
