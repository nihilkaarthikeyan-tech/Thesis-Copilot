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

import type { Editor } from '@tiptap/core';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';

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
  OUTLINE_DRIFT: 'Scope',
};

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
}: {
  documentId: string;
  chapterId: string;
  editor: Editor | null;
  /** Hands the flag to the section-command flow (D.1.3); counts as `COMMAND`. */
  onSuggestFix: (flag: Flag) => void;
}) {
  const [data, setData] = useState<FlagsResponse | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  async function run() {
    setRunning(true);
    setError(null);
    setStage('starting');
    try {
      const { runId } = await api<{ runId: string }>(`/documents/${documentId}/coherence/run`, {
        method: 'POST',
        body: JSON.stringify({ triggeredBy: 'MANUAL' }),
      });
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
      setError(
        e instanceof ApiError
          ? (e.problem.detail ?? e.problem.title)
          : ((e as Error).message ?? 'The check did not finish.'),
      );
    } finally {
      setRunning(false);
      setStage(null);
    }
  }

  async function act(flag: Flag, action: 'RESOLVE' | 'IGNORE') {
    const reason =
      action === 'IGNORE'
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

  const flags = (data?.flags ?? []).filter((f) => !filter || f.type === filter);
  const byChapter = new Map<string, Flag[]>();
  for (const flag of flags) {
    byChapter.set(flag.chapterTitle, [...(byChapter.get(flag.chapterTitle) ?? []), flag]);
  }
  for (const list of byChapter.values()) {
    list.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3));
  }

  return (
    <section data-testid="flags-panel">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs text-muted">
          {data?.lastRunAt
            ? `Last checked ${new Date(data.lastRunAt).toLocaleString()}`
            : 'Not checked yet'}
        </p>
        <button
          type="button"
          disabled={running}
          onClick={() => void run()}
          data-testid="run-coherence"
          className="rounded-md bg-ink px-3 py-1 text-xs text-paper disabled:opacity-50"
        >
          {running ? (stage ? `Checking ${stage.toLowerCase()}…` : 'Checking…') : 'Check coherence'}
        </button>
      </div>
      {estimate && !running ? (
        <p className="mt-1 text-xs text-muted">
          {estimate.changedChapters === 0
            ? 'Nothing has changed since the last check.'
            : `${estimate.changedChapters} chapter${estimate.changedChapters === 1 ? '' : 's'} changed · about ₹${estimate.estimatedInr} of AI, one coherence unit${estimate.willReduceScope ? ' · large run, some checks will be narrowed' : ''}`}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-xs text-warn">
          {error}
        </p>
      ) : null}

      {data && (data.counts.total ?? 0) > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1 text-xs">
          <button
            type="button"
            onClick={() => setFilter(null)}
            className={`rounded px-2 py-0.5 ${filter === null ? 'bg-ink text-paper' : 'border border-line'}`}
          >
            All {data.counts.total ?? 0}
          </button>
          {Object.entries(TYPE_LABEL).map(([type, label]) =>
            data.counts[type] ? (
              <button
                key={type}
                type="button"
                onClick={() => setFilter(filter === type ? null : type)}
                className={`rounded px-2 py-0.5 ${filter === type ? 'bg-ink text-paper' : 'border border-line'}`}
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
            ? 'No open flags. A check looks for contradictions between chapters, terms used against your own glossary, claims with no citation, and scope drift.'
            : 'Nothing of that type.'}
        </p>
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
                  className={`rounded-md border bg-surface p-2 text-xs ${SEVERITY_CLASS[flag.severity] ?? 'border-line'}`}
                >
                  <p className="font-medium">
                    {TYPE_LABEL[flag.type] ?? flag.type}
                    <span className="ml-2 font-normal text-muted">{flag.severity}</span>
                  </p>
                  <p className="mt-1">{flag.description}</p>
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
