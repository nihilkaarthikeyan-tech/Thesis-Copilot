'use client';

/**
 * `/app/d/:id/originality` — a read-only overlap check (ADR-0042).
 *
 * The student pastes a paragraph; this shows where it runs near-verbatim to the text of a source
 * the thesis holds, so they can quote it or rewrite it in their own words. It reports copied text
 * and never changes it — the opposite of detector evasion (§12.3). No AI runs; the comparison is
 * word overlap against the library's own passages.
 */

import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/primitives';
import { ApiError, api } from '@/lib/api';

type Match = { sourceId: string; label: string; quote: string; wordCount: number };
type Report = {
  overlapRatio: number;
  longestRunWords: number;
  matches: Match[];
  verdict: 'clear' | 'review' | 'high';
  comparedSources: number;
  comparedPassages: number;
};

const VERDICT: Record<Report['verdict'], { tone: 'ok' | 'warn' | 'danger'; text: string }> = {
  clear: { tone: 'ok', text: 'Nothing close to a source' },
  review: { tone: 'warn', text: 'Some passages run close — worth a look' },
  high: { tone: 'danger', text: 'A lot runs close to your sources' },
};

export function OriginalityScreen({ documentId }: { documentId: string }) {
  const [passage, setPassage] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function check() {
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const next = await api<Report>(`/documents/${documentId}/overlap`, {
        method: 'POST',
        body: JSON.stringify({ passage }),
      });
      setReport(next);
    } catch (e) {
      setError(e instanceof ApiError ? e.problem.title : 'Could not run the check.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <nav className="text-xs text-muted">
        <Link href="/app" className="hover:underline">
          Theses
        </Link>{' '}
        /{' '}
        <Link href={`/app/d/${documentId}/submit`} className="hover:underline">
          Submit
        </Link>{' '}
        / Originality
      </nav>
      <h1 className="mt-2 text-balance text-[28px] font-bold leading-tight tracking-[-0.02em] text-ink">
        Originality check
      </h1>
      <p className="mt-1 text-sm text-muted">
        Paste a paragraph to see where it runs near-verbatim to a source you cite. This flags copied
        wording so you can quote it or rewrite it. It never changes your text, and it is not a way
        to get past a detector.
      </p>

      <textarea
        value={passage}
        onChange={(e) => setPassage(e.target.value)}
        rows={8}
        placeholder="Paste a paragraph of your draft…"
        className="mt-5 w-full rounded-md border border-line bg-surface p-3 text-sm"
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void check()}
          disabled={busy || passage.trim().length === 0}
          className="h-9 rounded-sm bg-accent px-3 text-sm font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-50"
        >
          {busy ? 'Checking…' : 'Check'}
        </button>
        <span className="text-xs text-muted">Nothing is saved or sent to a model.</span>
      </div>

      {error ? (
        <p role="alert" className="mt-4 text-sm text-warn">
          {error}
        </p>
      ) : null}

      {report ? (
        <section className="mt-6" data-testid="overlap-report">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={VERDICT[report.verdict].tone}>{VERDICT[report.verdict].text}</Badge>
            <span className="text-sm text-muted">
              {Math.round(report.overlapRatio * 100)}% of the paragraph overlaps; longest shared run{' '}
              {report.longestRunWords} words.
            </span>
          </div>
          <p className="mt-1 text-xs text-muted">
            Compared against {report.comparedPassages} passages from {report.comparedSources}{' '}
            {report.comparedSources === 1 ? 'source' : 'sources'} in your library.
          </p>

          {report.matches.length > 0 ? (
            <ul className="mt-4 space-y-3">
              {report.matches.map((m) => (
                <li
                  key={`${m.sourceId}-${m.wordCount}-${m.quote}`}
                  className="rounded-md border border-warn/40 bg-warn/5 p-3"
                >
                  <p className="text-xs font-semibold text-ink">
                    {m.label} · {m.wordCount} words in common
                  </p>
                  <p className="mt-1 text-sm italic text-muted">“{m.quote}”</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-muted">
              No run of copied wording found against your library. If you quoted a source, make sure
              it is in quotation marks and cited.
            </p>
          )}
        </section>
      ) : null}
    </main>
  );
}
