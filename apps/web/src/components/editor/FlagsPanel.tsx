'use client';

/**
 * The Flags tab — PRD §5.6, Appendix D.1.3, PHASES v2 B1.8.
 *
 *   "grouped by chapter, then severity; filter chips by type; count badge in the top bar. Each
 *    item shows type, severity, description, and a 'Go to' … Actions: Resolve, Ignore, Suggest
 *    fix. Flags are never applied automatically."
 *
 * "Never applied automatically" is the whole shape of this panel: nothing here edits the chapter.
 * Go to selects a range, Suggest fix opens the section-command flow with the flag's description as
 * the instruction, and the student decides. A flag whose chapter has changed since the run says so
 * instead of scrolling somewhere wrong.
 */

import { wordsAt } from '@tc/ui';
import type { Editor } from '@tiptap/core';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { BlockCheckRequest } from '@/lib/block-check';
import { examinerLabel } from '@/lib/examiner-review';
import { JOB_EMAIL_NOTE, useJobEmailSetting, watchingParam } from '@/lib/job-watch';
import { openCheck, startReview } from '@/lib/review-mode';
import { LimitNotice, useLimit } from '../LimitNotice';
import { ExaminerReview } from './ExaminerReview';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export type Flag = {
  id: string;
  chapterId: string;
  chapterTitle: string;
  relatedChapterId: string | null;
  relatedChapterTitle: string | null;
  type: string;
  severity: string;
  description: string;
  /** The examiner's suggested correction (ADR-0056); null for the coherence checks. */
  suggestion?: string | null;
  from: number;
  to: number;
  status: string;
  ignoreReason: string | null;
  createdAt: string;
  positionTrusted: boolean;
};

type FlagsResponse = {
  flags: Flag[];
  counts: Record<string, number>;
  lastRunAt: string | null;
};

const TYPE_LABEL: Record<string, string> = {
  CITATION_INTEGRITY: 'Citations',
  TERM_DRIFT: 'Terms',
  CLAIM_CONTRADICTION: 'Contradictions',
  UNSUPPORTED_CLAIM: 'Unsupported',
  // ADR-0023: whether the cited passage says what the sentence says it does.
  CITATION_SUPPORT: 'Source support',
  OUTLINE_DRIFT: 'Scope',
  // ADR-0056: the examiner review's issues, one per sentence.
  EXAMINER: 'Examiner',
};

/** A flag's heading: the examiner's carry their severity in words, the others their type. */
export function flagLabel(flag: Pick<Flag, 'type' | 'severity'>): string {
  if (flag.type === 'EXAMINER') return examinerLabel(flag.severity);
  return TYPE_LABEL[flag.type] ?? flag.type;
}

const SEVERITY_ORDER: Record<string, number> = { ERROR: 0, WARN: 1, INFO: 2 };

const SEVERITY_CLASS: Record<string, string> = {
  ERROR: 'border-warn text-warn',
  WARN: 'border-warn/50',
  INFO: 'border-line text-muted',
};

export function FlagsPanel({
  documentId,
  chapterId,
  editor,
  onSuggestFix,
  onFindPapers,
  request,
  save,
  onNotice,
}: {
  documentId: string;
  chapterId: string;
  editor: Editor | null;
  /** R26 (ADR-0126): an examiner review of one paragraph or a selection, asked for in the text. */
  request?: BlockCheckRequest | null;
  /** Saves what is on screen before a review reads the saved chapter. */
  save?: () => Promise<void>;
  /** The editor's notice line. */
  onNotice?: (text: string) => void;
  /** Hands the flag to the section-command flow (D.1.3); counts as `COMMAND`. */
  onSuggestFix: (flag: Flag) => void;
  /**
   * Row 54 of the Jenni coverage map (2026-10-05): a claim with no source, or whose source does
   * not support it, opens the Papers tab searching for the flagged sentence, so a supporting
   * paper can be found, added and cited from there. No allowance: the search has no model call.
   */
  onFindPapers?: (text: string) => void;
}) {
  const [data, setData] = useState<FlagsResponse | null>(null);
  /** R24: set when an examiner review finishes, so its points open in the text once loaded. */
  const [openExaminer, setOpenExaminer] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const limit = useLimit();
  /**
   * False when the plan has no coherence checks (the free trial): the button is replaced by a
   * plain line instead of a refusal after the press (2026-10-04, found writing the help pages).
   */
  // ADR-0071: unknown until the usage line arrives. Assuming "included" showed the button, then
  // swapped it for a sentence a moment later, and the panel jumped under the student's click.
  const [included, setIncluded] = useState<boolean | null>(null);
  useEffect(() => {
    api<{ actions: Array<{ action: string; cap: number; used: number }> }>('/usage/me')
      .then((u) => {
        const line = u.actions.find((a) => a.action === 'COHERENCE');
        setIncluded(!line || line.cap > 0 || line.used > 0);
      })
      .catch(() => undefined);
  }, []);
  const [estimate, setEstimate] = useState<{
    changedChapters: number;
    estimatedInr: number;
    willReduceScope: boolean;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<FlagsResponse>(`/documents/${documentId}/coherence/flags`));
    } catch (e) {
      setError(e instanceof ApiError ? e.problem.title : 'Could not load the flags.');
    }
    api<typeof estimate>(`/documents/${documentId}/coherence/estimate`)
      .then(setEstimate)
      .catch(() => undefined);
  }, [documentId]);

  useEffect(() => {
    void load();
  }, [load]);

  // ADR-0058: the stream says how the run is going but not whether anyone can see it. While it
  // runs, a visible tab says so every ten seconds; a hidden or closed one does not, and then the
  // worker emails the student when the check is done.
  const [runId, setRunId] = useState<string | null>(null);
  const emailOn = useJobEmailSetting();
  useEffect(() => {
    if (!running || !runId) return;
    const beat = () => {
      const param = watchingParam();
      if (param) void api(`/documents/${documentId}/coherence/${runId}${param}`).catch(() => null);
    };
    beat();
    const timer = setInterval(beat, 10_000);
    return () => clearInterval(timer);
  }, [running, runId, documentId]);

  async function run() {
    setRunning(true);
    setError(null);
    limit.clear();
    setStage('starting');
    try {
      const { runId } = await api<{ runId: string }>(`/documents/${documentId}/coherence/run`, {
        method: 'POST',
        body: JSON.stringify({ triggeredBy: 'MANUAL' }),
      });
      setRunId(runId);
      // D.1.1 step 3: the run reports each check as it finishes, so the panel is not a spinner.
      const response = await fetch(
        `${API_URL}/api/v1/documents/${documentId}/coherence/${runId}/events`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
          body: '{}',
        },
      );
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const name = /^event:\s*(.*)$/m.exec(frame)?.[1]?.trim();
          const dataLine = /^data:\s*(.*)$/m.exec(frame)?.[1];
          if (!name || !dataLine) continue;
          const payload = JSON.parse(dataLine) as Record<string, unknown>;
          if (name === 'check-started') setStage(String(payload.type ?? ''));
          else if (name === 'run-done') setStage(null);
          else if (name === 'error')
            throw new Error(String(payload.message ?? 'The check failed.'));
        }
      }
      await load();
    } catch (e) {
      if (limit.take(e)) return;
      setError(
        e instanceof ApiError
          ? (e.problem.detail ?? e.problem.title)
          : ((e as Error).message ?? 'The check did not finish.'),
      );
    } finally {
      setRunning(false);
      setStage(null);
      setRunId(null);
    }
  }

  async function act(flag: Flag, action: 'RESOLVE' | 'IGNORE', quiet = false) {
    const reason =
      action === 'IGNORE' && !quiet
        ? (window.prompt('Why is this not a problem? (optional — it is kept with the flag)') ?? '')
        : undefined;
    try {
      await api(`/documents/${documentId}/coherence/flags/${flag.id}`, {
        method: 'POST',
        body: JSON.stringify({ action, ...(reason ? { reason } : {}) }),
      });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not save.');
    }
  }

  /**
   * Every open flag in the list at once (row 59 of the Jenni coverage map, 2026-10-05): the
   * student has read them and wants them gone, or wants them all kept out of the count. Still
   * their explicit action, and confirmed, because a resolve cannot be undone from here.
   */
  async function actAll(action: 'RESOLVE' | 'IGNORE') {
    const list = (data?.flags ?? []).filter((f) => !filter || f.type === filter);
    if (list.length === 0) return;
    const verb = action === 'RESOLVE' ? 'Resolve' : 'Ignore';
    if (!window.confirm(`${verb} all ${list.length} flags shown?`)) return;
    try {
      for (const flag of list) {
        await api(`/documents/${documentId}/coherence/flags/${flag.id}`, {
          method: 'POST',
          body: JSON.stringify({ action }),
        });
      }
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not save.');
    }
  }

  const flags = (data?.flags ?? []).filter((f) => !filter || f.type === filter);
  /** R23 (ADR-0110): the flags on this chapter that can be shown on their words. */
  const inText = flags.filter(
    (f) => f.chapterId === chapterId && f.positionTrusted && f.to > f.from,
  );

  /** Walks through this chapter's flags in the text: Y resolves, N ignores (no reason asked). */
  function reviewInText(list: Flag[] = inText, title = 'Flags') {
    if (!editor || list.length === 0) return;
    const byId = new Map(list.map((f) => [f.id, f]));
    startReview({
      title,
      items: list.map((f) => ({
        id: f.id,
        from: f.from,
        to: f.to,
        original: wordsAt(editor.state.doc, f.from, f.to),
        replacement: null,
        label:
          f.type === 'EXAMINER' ? flagLabel(f) : `${flagLabel(f)} · ${f.severity.toLowerCase()}`,
        why: f.suggestion ? `${f.description} Suggested: ${f.suggestion}` : f.description,
      })),
      decide: async (id, accepted) => {
        const flag = byId.get(id);
        if (flag) await act(flag, accepted ? 'RESOLVE' : 'IGNORE', true);
      },
      next: { label: 'Spelling and grammar', open: () => openCheck('proofread-run') },
    });
  }

  // R24 (ADR-0111): a review that has just finished opens in the text, each point tagged Major or
  // Minor on its sentence, as Jenni's peer review leaves its comments in the document.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the reloaded list arrives
  useEffect(() => {
    if (!openExaminer || !data) return;
    setOpenExaminer(false);
    const points = data.flags.filter(
      (f) =>
        f.type === 'EXAMINER' &&
        f.chapterId === chapterId &&
        f.status === 'OPEN' &&
        f.positionTrusted &&
        f.to > f.from,
    );
    reviewInText(points, 'Examiner review');
  }, [openExaminer, data]);

  const byChapter = new Map<string, Flag[]>();
  for (const flag of flags) {
    byChapter.set(flag.chapterTitle, [...(byChapter.get(flag.chapterTitle) ?? []), flag]);
  }
  for (const list of byChapter.values()) {
    list.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3));
  }

  return (
    <section data-testid="flags-panel">
      <ExaminerReview
        chapterId={chapterId}
        request={request}
        save={save}
        onNotice={onNotice}
        onFinished={async () => {
          await load();
          setOpenExaminer(true);
        }}
      />
      {/* A plan without coherence checks says that once, across the panel. It used to share the
          row with "Not checked yet", which was squeezed into a one-word column, and the line below
          still said "uses one coherence check from your plan" (2026-10-08, seen in a screenshot). */}
      {included === false ? (
        <p className="text-xs text-muted" data-testid="coherence-not-included">
          Coherence checks are not included in your plan.{' '}
          <a href="/pricing" className="underline">
            See plans
          </a>
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-xs text-muted">
              {data?.lastRunAt
                ? `Last checked ${new Date(data.lastRunAt).toLocaleString()}`
                : 'Not checked yet'}
            </p>
            <button
              type="button"
              disabled={running || included === null}
              onClick={() => void run()}
              data-testid="run-coherence"
              className="rounded-md px-3 py-1 text-xs disabled:opacity-50 bg-accent text-accent-ink hover:bg-accent-hover font-semibold transition-colors"
            >
              {running
                ? stage
                  ? `Checking ${stage.toLowerCase()}…`
                  : 'Checking…'
                : 'Check coherence'}
            </button>
          </div>
          {running && emailOn ? (
            <p className="mt-1 text-xs text-muted" data-testid="job-email-note">
              {JOB_EMAIL_NOTE}
            </p>
          ) : null}
          {/* ADR-0071: the line's space is held while the estimate loads, so nothing below it
              moves; and the student is told what it uses from their plan, not what it costs us. */}
          <p className="mt-1 min-h-[1rem] text-xs text-muted">
            {estimate && !running
              ? estimate.changedChapters === 0
                ? 'Nothing has changed since the last check.'
                : `${estimate.changedChapters} chapter${estimate.changedChapters === 1 ? '' : 's'} changed · uses one coherence check from your plan${estimate.willReduceScope ? ' · large run, some checks will be narrowed' : ''}`
              : null}
          </p>
        </>
      )}

      {error ? (
        <p role="alert" className="mt-2 text-xs text-warn">
          {error}
        </p>
      ) : null}
      <LimitNotice limit={limit.value} className="mt-2" />

      {data && (data.counts.total ?? 0) > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1 text-xs">
          <button
            type="button"
            onClick={() => setFilter(null)}
            className={`rounded px-2 py-0.5 ${filter === null ? 'bg-accent text-accent-ink font-semibold' : 'border border-line text-muted hover:border-line-strong hover:text-ink'}`}
          >
            All {data.counts.total ?? 0}
          </button>
          {Object.entries(TYPE_LABEL).map(([type, label]) =>
            data.counts[type] ? (
              <button
                key={type}
                type="button"
                onClick={() => setFilter(filter === type ? null : type)}
                className={`rounded px-2 py-0.5 ${filter === type ? 'bg-accent text-accent-ink font-semibold' : 'border border-line text-muted hover:border-line-strong hover:text-ink'}`}
              >
                {label} {data.counts[type]}
              </button>
            ) : null,
          )}
        </div>
      ) : null}

      {data && flags.length === 0 ? (
        <p className="mt-4 text-xs text-muted">
          {(data.counts.total ?? 0) === 0
            ? 'No open flags. A coherence check looks for contradictions between chapters, terms used against your own glossary, claims with no citation, and scope drift; an examiner review reads one chapter against its sources.'
            : 'Nothing of that type.'}
        </p>
      ) : null}

      {inText.length > 0 && editor ? (
        <button
          type="button"
          data-testid="flags-review-in-text"
          onClick={() => reviewInText()}
          className="mt-3 block text-xs font-semibold text-accent underline"
        >
          Review in the text ({inText.length})
        </button>
      ) : null}

      {flags.length > 1 ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-muted" data-testid="flags-keys">
            Tab to a flag, then G to go to it, Y or R to resolve, N or I to ignore, J and K to move.
          </p>
          <span className="flex gap-2">
            <button
              type="button"
              data-testid="flags-resolve-all"
              onClick={() => void actAll('RESOLVE')}
              className="text-[11px] font-semibold text-accent underline"
            >
              Resolve all {flags.length}
            </button>
            <button
              type="button"
              data-testid="flags-ignore-all"
              onClick={() => void actAll('IGNORE')}
              className="text-[11px] text-muted underline hover:text-ink"
            >
              Ignore all
            </button>
          </span>
        </div>
      ) : null}

      <div className="mt-3 space-y-4">
        {[...byChapter.entries()].map(([title, list]) => (
          <div key={title}>
            <p className="text-xs font-medium">{title}</p>
            <ul className="mt-1 space-y-2">
              {list.map((flag) => (
                <li
                  key={flag.id}
                  data-testid="flag"
                  data-type={flag.type}
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: a focusable row for keyboard review
                  tabIndex={0}
                  aria-label={`${flagLabel(flag)}: ${flag.description}. G to go to it, Y to resolve, N to ignore, J and K for the next and previous.`}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    const key = e.key.toLowerCase();
                    // Keyboard review (2026-10-04, from the Jenni study): the flags can be
                    // worked through without the mouse, one at a time.
                    const rows = [
                      ...(e.currentTarget
                        .closest('[data-testid="flags-panel"]')
                        ?.querySelectorAll<HTMLElement>('[data-testid="flag"]') ?? []),
                    ];
                    const at = rows.indexOf(e.currentTarget);
                    if (key === 'j' || key === 'k') {
                      e.preventDefault();
                      rows[at + (key === 'j' ? 1 : -1)]?.focus();
                    } else if (key === 'r' || key === 'i' || key === 'y' || key === 'n') {
                      // Y / N as proofreading has them (row 59); R / I stay for anyone used to them.
                      e.preventDefault();
                      (rows[at + 1] ?? rows[at - 1])?.focus();
                      void act(flag, key === 'r' || key === 'y' ? 'RESOLVE' : 'IGNORE');
                    } else if (
                      key === 'g' &&
                      flag.chapterId === chapterId &&
                      editor &&
                      flag.positionTrusted
                    ) {
                      e.preventDefault();
                      editor
                        .chain()
                        .setTextSelection({ from: flag.from, to: flag.to })
                        .scrollIntoView()
                        .run();
                    }
                  }}
                  className={`rounded-md border bg-surface p-2 text-xs focus:outline focus:outline-2 focus:outline-accent ${SEVERITY_CLASS[flag.severity] ?? 'border-line'}`}
                >
                  <p className="font-medium">
                    {flagLabel(flag)}
                    {flag.type === 'EXAMINER' ? null : (
                      <span className="ml-2 font-normal text-muted">{flag.severity}</span>
                    )}
                  </p>
                  <p className="mt-1">{flag.description}</p>
                  {flag.suggestion ? (
                    <p className="mt-1 text-muted">Suggested correction: {flag.suggestion}</p>
                  ) : null}
                  {flag.relatedChapterTitle ? (
                    <p className="mt-1 text-muted">Against {flag.relatedChapterTitle}</p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-3">
                    {flag.chapterId === chapterId && editor ? (
                      flag.positionTrusted ? (
                        <button
                          type="button"
                          className="underline"
                          onClick={() =>
                            editor
                              .chain()
                              .focus()
                              .setTextSelection({ from: flag.from, to: flag.to })
                              .scrollIntoView()
                              .run()
                          }
                        >
                          Go to
                        </button>
                      ) : (
                        <span className="text-muted">location moved — re-run</span>
                      )
                    ) : null}
                    <button
                      type="button"
                      className="underline"
                      onClick={() => void act(flag, 'RESOLVE')}
                    >
                      Resolve
                    </button>
                    <button
                      type="button"
                      className="underline"
                      onClick={() => void act(flag, 'IGNORE')}
                    >
                      Ignore
                    </button>
                    {flag.chapterId === chapterId && flag.positionTrusted && flag.to > flag.from ? (
                      <button
                        type="button"
                        className="underline"
                        onClick={() => onSuggestFix(flag)}
                      >
                        Suggest fix
                      </button>
                    ) : null}
                    {onFindPapers &&
                    (flag.type === 'UNSUPPORTED_CLAIM' || flag.type === 'CITATION_SUPPORT') ? (
                      <button
                        type="button"
                        data-testid="flag-find-source"
                        className="underline"
                        onClick={() =>
                          onFindPapers(
                            flag.chapterId === chapterId &&
                              flag.positionTrusted &&
                              flag.to > flag.from &&
                              editor
                              ? editor.state.doc.textBetween(flag.from, flag.to, ' ')
                              : flag.description,
                          )
                        }
                      >
                        Find a source
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
