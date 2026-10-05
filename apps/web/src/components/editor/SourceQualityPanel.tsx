'use client';

/**
 * Source quality — ADR-0076.
 *
 * The side-by-side study (2026-10-05) found Jenni's review panel checks a document's sources for
 * retractions, preprints and quality, and that both tools had leaned on a month-old, uncited paper
 * in a journal with a citedness of 0.2. This lists the library's papers with a standing problem,
 * the ones the thesis cites first, with one plain sentence each. Facts from the record we hold;
 * nothing is changed, and no model is called.
 */

import { useCallback, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { readerHref } from '@/lib/reader';

type Report = {
  checked: number;
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

export function SourceQualityPanel({ documentId }: { documentId: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setReport(await api<Report>(`/documents/${documentId}/sources/quality`));
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not run the check.',
      );
    } finally {
      setBusy(false);
    }
  }, [documentId]);

  return (
    <section className="mt-4 border-t border-line pt-3" data-testid="source-quality-panel">
      <p className="eyebrow">Source quality</p>
      <p className="mt-1 text-xs text-muted">
        Checks the papers in your library for retractions, preprints, papers no one has cited, and
        rarely cited journals — the ones your thesis cites first. Nothing is sent to a model.
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

      {report ? (
        report.sources.length === 0 ? (
          <p className="mt-2 text-xs text-ok" data-testid="source-quality-clean">
            Nothing to flag. {report.checked} papers checked.
          </p>
        ) : (
          <ul className="mt-2 grid list-none gap-2 p-0" data-testid="source-quality-list">
            {report.sources.map((source) => (
              <li key={source.id} className="rounded-md border border-line bg-surface p-2 text-xs">
                <a
                  href={readerHref(documentId, source.id)}
                  className="font-medium text-ink underline-offset-2 hover:underline"
                >
                  {source.title ?? 'Untitled paper'}
                  {source.year ? ` (${source.year})` : ''}
                </a>
                <p className="mt-0.5 text-faint">
                  {source.citedInThesis > 0
                    ? `Cited ${source.citedInThesis} time${source.citedInThesis === 1 ? '' : 's'} in your thesis`
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
