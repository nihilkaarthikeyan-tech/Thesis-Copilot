'use client';

/**
 * Source quality — ADR-0076.
 *
 * The side-by-side study (2026-10-05) found Jenni's review panel checks a document's sources for
 * retractions, preprints and quality, and that both tools had leaned on a month-old, uncited paper
 * in a journal with a citedness of 0.2. This lists the library's papers with a standing problem,
 * the ones the thesis cites first, with one plain sentence each. Facts from the record we hold;
 * nothing is changed, and no model is called.
 *
 * R25 (ADR-0112): above that list, the bibliography notes for the open chapter — a
 * publication-year chart and the venue spread of the papers it cites. The chapter is saved first,
 * because the notes are read from the citation rows each save keeps.
 */

import { useCallback, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { type BibliographyNotes, checkedPhrase, citedTimes } from '@/lib/bibliography-notes';
import { readerHref } from '@/lib/reader';
import { BibliographyNotesView } from './BibliographyNotes';

type Report = {
  checked: number;
  notes: BibliographyNotes | null;
  sources: Array<{
    id: string;
    title: string | null;
    year: number | null;
    citedInThesis: number;
    issues: Array<{ code: string; advice: string }>;
  }>;
};

const LABEL: Record<string, string> = {
  RETRACTED: 'Retracted',
  PREPRINT: 'Preprint',
  UNCITED: 'Uncited',
  WEAK_VENUE: 'Rarely cited journal',
};

export function SourceQualityPanel({
  documentId,
  chapterId,
  save,
}: {
  documentId: string;
  chapterId: string;
  /** Flushes the chapter's pending autosave, so its citation rows are what is on screen. */
  save: () => Promise<void>;
}) {
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await save();
      setReport(
        await api<Report>(
          `/documents/${documentId}/sources/quality?chapterId=${encodeURIComponent(chapterId)}`,
        ),
      );
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not run the check.',
      );
    } finally {
      setBusy(false);
    }
  }, [documentId, chapterId, save]);

  return (
    <section className="mt-4 border-t border-line pt-3" data-testid="source-quality-panel">
      <p className="eyebrow">Source quality</p>
      <p className="mt-1 text-xs text-muted">
        Charts the years and journals of the papers this chapter cites, and checks the papers in
        your library for retractions, preprints, papers no one has cited, and rarely cited journals
        — the ones your thesis cites first. Nothing is sent to a model.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => void run()}
        data-testid="source-quality-run"
        className="mt-2 rounded-md border border-line-strong bg-surface px-3 py-1 text-xs font-semibold text-ink transition-colors hover:bg-sunk disabled:opacity-50"
      >
        {busy ? 'Checking…' : 'Check my sources'}
      </button>

      {error ? (
        <p role="alert" className="mt-2 text-xs text-warn">
          {error}
        </p>
      ) : null}

      {report?.notes ? <BibliographyNotesView notes={report.notes} /> : null}

      {report?.notes ? (
        <p className="mt-3 text-[11px] font-semibold text-ink">The papers in your library</p>
      ) : null}
      {report ? (
        report.sources.length === 0 ? (
          <p className="mt-2 text-xs text-ok" data-testid="source-quality-clean">
            Nothing to flag. {checkedPhrase(report.checked)}
          </p>
        ) : (
          <ul
            className="mt-2 grid list-none grid-cols-1 gap-2 p-0"
            data-testid="source-quality-list"
          >
            {report.sources.map((source) => (
              <li
                key={source.id}
                className="min-w-0 break-words rounded-md border border-line bg-surface p-2 text-xs"
              >
                <a
                  href={readerHref(documentId, source.id)}
                  className="font-medium text-ink underline-offset-2 hover:underline"
                >
                  {source.title ?? 'Untitled paper'}
                  {source.year ? ` (${source.year})` : ''}
                </a>
                <p className="mt-0.5 text-faint">
                  {source.citedInThesis > 0
                    ? citedTimes(source.citedInThesis)
                    : 'Not cited in your thesis yet'}
                </p>
                {source.issues.map((issue) => (
                  <p
                    key={issue.code}
                    className={`mt-1 ${issue.code === 'RETRACTED' ? 'text-warn' : 'text-muted'}`}
                  >
                    <span className="font-semibold">{LABEL[issue.code] ?? issue.code}.</span>{' '}
                    {issue.advice}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}
