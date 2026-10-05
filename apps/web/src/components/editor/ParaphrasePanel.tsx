'use client';

/**
 * "This sentence is very close to Kumar 2021" (2026-09-21).
 *
 * Finds where a chapter reuses a source's phrasing without citing it, while there is still time
 * to fix it cheaply — rather than at submission, when a similarity report calls it plagiarism and
 * nobody can remember whether it was deliberate.
 *
 * ## What this must never become
 *
 * PRD §12.3 bans humanise and detector-evasion tooling. This is the inverse of one, and the
 * difference is entirely in what the buttons do: **Show me** moves the caret to the sentence, and
 * the advice is always to quote or cite. There is deliberately no "rewrite this for me" action
 * here, and adding one would turn the feature into the banned one.
 *
 * Costs nothing to run — no model, no embedding — so it is a button rather than something the
 * student has to spend a cap unit on.
 */

import type { Editor } from '@tiptap/core';
import { useCallback, useState } from 'react';
import { ApiError, api } from '@/lib/api';

type Match = {
  sentenceId: string;
  from: number;
  to: number;
  sentence: string;
  sourceId: string;
  shortRef: string;
  page: number | null;
  passage: string;
  overlapText: string;
  overlapWords: number;
  kind: 'verbatim' | 'close';
};

type Report = { checked: number; matches: Match[]; headline: string | null };

export function ParaphrasePanel({
  chapterId,
  editor,
}: {
  chapterId: string;
  editor: Editor | null;
}) {
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setReport(await api<Report>(`/chapters/${chapterId}/paraphrase`));
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not run the check.',
      );
    } finally {
      setBusy(false);
    }
  }, [chapterId]);

  return (
    <section className="mt-4 border-t border-line pt-3" data-testid="paraphrase-panel">
      <p className="eyebrow">Too close to a source?</p>
      <p className="mt-1 text-xs text-muted">
        Checks this chapter against the papers in your library for sentences that reuse their
        wording: uncited, or cited but copied word for word without quotation marks. Nothing is sent
        to a model, and nothing is changed.
      </p>

      <button
        type="button"
        disabled={busy}
        onClick={() => void run()}
        data-testid="paraphrase-run"
        className="mt-2 rounded-md border border-line-strong bg-surface px-3 py-1 text-xs font-semibold text-ink transition-colors hover:bg-sunk disabled:opacity-50"
      >
        {busy ? 'Checking…' : 'Check this chapter'}
      </button>

      {error ? (
        <p role="alert" className="mt-2 text-xs text-warn">
          {error}
        </p>
      ) : null}

      {report ? (
        report.matches.length === 0 ? (
          <p className="mt-2 text-xs text-ok" data-testid="paraphrase-clean">
            Nothing to flag. {report.checked} sentences checked against your library.
          </p>
        ) : (
          <>
            <p className="mt-2 text-xs text-warn">{report.headline}</p>
            <ul className="mt-2 grid list-none gap-2 p-0" data-testid="paraphrase-matches">
              {report.matches.map((match) => (
                <li
                  key={match.sentenceId}
                  className="rounded-md border border-line bg-surface p-2 text-xs"
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-ink">
                      {match.kind === 'verbatim' ? 'Same wording' : 'Very close'}
                    </span>
                    <span className="shrink-0 text-muted">
                      {match.shortRef}
                      {match.page ? `, p. ${match.page}` : ''}
                    </span>
                  </span>

                  <p className="mt-1 text-muted">
                    {match.overlapWords} words match:{' '}
                    <span className="text-ink">“{match.overlapText}”</span>
                  </p>

                  <p className="mt-1 text-faint">Their passage: {match.passage.slice(0, 180)}…</p>

                  <p className="mt-1 text-muted">
                    {match.kind === 'verbatim'
                      ? 'If those are their words, put them in quotation marks and cite the page.'
                      : 'Cite it — and if the wording is still theirs, quote it.'}
                  </p>

                  {editor ? (
                    <button
                      type="button"
                      className="mt-1 underline"
                      onClick={() =>
                        editor
                          .chain()
                          .focus()
                          .setTextSelection({ from: match.from, to: match.to })
                          .run()
                      }
                    >
                      Show me
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )
      ) : null}
    </section>
  );
}
