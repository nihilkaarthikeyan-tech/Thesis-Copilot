'use client';

/**
 * `/app/d/:id/citations` — every weak citation in the thesis on one page (2026-09-25).
 *
 * Five checks already existed, each on its own panel; the week before submission a student had
 * to open all of them to know where they stood. This lists their findings together, worst first,
 * each linking to the sentence or the source it is about. It reads only: opening it never spends
 * a coherence run, and nothing is changed until the student changes it.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/primitives';
import { ApiError, api } from '@/lib/api';

type Severity = 'high' | 'medium' | 'low';

type Item = {
  key: string;
  severity: Severity;
  check: 'citations' | 'references' | 'reading' | 'support' | 'density';
  kind: string;
  title: string;
  message: string;
  chapterId?: string;
  chapterTitle?: string;
  from?: number;
  to?: number;
  sourceId?: string;
  shortRef?: string;
};

type Report = {
  headline: string;
  counts: Record<Severity | 'total', number>;
  citations: number;
  sources: number;
  supportCheck: { lastRunAt: string | null; outOfDate: boolean };
  items: Item[];
};

type DocumentDetail = { id: string; title: string; chapters: Array<{ id: string; order: number }> };

const GROUPS: Array<{ severity: Severity; heading: string; blurb: string }> = [
  {
    severity: 'high',
    heading: 'Fix before anyone reads it',
    blurb: 'A citation to nothing, a retracted paper, a source that says something else.',
  },
  {
    severity: 'medium',
    heading: 'Worth fixing',
    blurb: 'Things an examiner may notice.',
  },
  {
    severity: 'low',
    heading: 'Minor',
    blurb: 'Housekeeping. None of these will stop a submission.',
  },
];

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

const TONE = { high: 'danger', medium: 'warn', low: 'neutral' } as const;

const CHECK_LABEL: Record<Item['check'], string> = {
  citations: 'Citation check',
  references: 'Reference health',
  reading: 'Reading depth',
  support: 'Support check',
  density: 'Citation density',
};

export function CitationReport({ documentId }: { documentId: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [next, detail] = await Promise.all([
        api<Report>(`/documents/${documentId}/citation-report`),
        api<DocumentDetail>(`/documents/${documentId}`),
      ]);
      setReport(next);
      setDoc(detail);
    } catch (e) {
      setError(e instanceof ApiError ? e.problem.title : 'Could not build the report.');
    }
  }, [documentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const firstChapter = doc?.chapters.slice().sort((a, b) => a.order - b.order)[0];
  const where = (item: Item) => {
    if (item.chapterId) {
      const at =
        item.from !== undefined && item.to !== undefined ? `?from=${item.from}&to=${item.to}` : '';
      return {
        href: `/app/d/${documentId}/write/${item.chapterId}${at}`,
        label: at
          ? `Show in ${item.chapterTitle ?? 'the chapter'}`
          : `Open ${item.chapterTitle ?? 'the chapter'}`,
      };
    }
    if (item.sourceId) return { href: `/app/d/${documentId}/sources`, label: 'Open the library' };
    return null;
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <nav className="text-xs text-muted print:hidden">
        <Link href="/app" className="hover:underline">
          Theses
        </Link>{' '}
        /{' '}
        <Link href={`/app/d/${documentId}/submit`} className="hover:underline">
          Submit
        </Link>{' '}
        / Citation report
      </nav>
      <h1 className="mt-2 text-balance text-[28px] font-bold leading-tight tracking-[-0.02em] text-ink">
        Citation report
        {doc ? <span className="block text-base text-muted">{doc.title}</span> : null}
      </h1>

      {error ? (
        <p role="alert" className="mt-4 text-sm text-warn">
          {error}
        </p>
      ) : null}

      {report ? (
        <>
          <section className="mt-6 rounded-md border border-line bg-surface p-4">
            <p className="font-semibold text-ink" data-testid="citation-report-headline">
              {report.headline}
            </p>
            <p className="mt-1 text-xs text-muted">
              {plural(report.citations, 'citation')} to {plural(report.sources, 'source')}, read by
              five checks: the citation check, reference health, reading depth, and the coherence
              run’s support check and uncited claims. No AI runs when you open this page.
            </p>
            <p className="mt-2 text-xs" data-testid="citation-report-support">
              {report.supportCheck.lastRunAt === null ? (
                <span className="text-warn">
                  The support check has never run, so this report cannot yet say whether your
                  sources say what your sentences claim. Run it with “Check coherence” in the Check
                  panel of{' '}
                  {firstChapter ? (
                    <Link
                      href={`/app/d/${documentId}/write/${firstChapter.id}`}
                      className="underline"
                    >
                      any chapter
                    </Link>
                  ) : (
                    'any chapter'
                  )}
                  .
                </span>
              ) : (
                <span className="text-muted">
                  Support check last run{' '}
                  {new Date(report.supportCheck.lastRunAt).toLocaleDateString(undefined, {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                  .
                  {report.supportCheck.outOfDate
                    ? ' Some chapters have changed since; run it again for the current text.'
                    : ''}
                </span>
              )}
            </p>
            <div className="mt-3 flex gap-3 print:hidden">
              <button
                type="button"
                onClick={() => void load()}
                className="rounded-md border border-line-strong px-3 py-1.5 text-xs font-semibold text-ink hover:bg-sunk"
              >
                Check again
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="rounded-md border border-line-strong px-3 py-1.5 text-xs font-semibold text-ink hover:bg-sunk"
              >
                Print or save as PDF
              </button>
            </div>
          </section>

          {GROUPS.map((group) => {
            const items = report.items.filter((item) => item.severity === group.severity);
            if (items.length === 0) return null;
            return (
              <section
                key={group.severity}
                className="mt-6"
                data-testid={`citation-report-${group.severity}`}
              >
                <h2 className="eyebrow">
                  {group.heading} · {items.length}
                </h2>
                <p className="mt-1 text-xs text-muted">{group.blurb}</p>
                <ul className="mt-3 space-y-3">
                  {items.map((item) => {
                    const link = where(item);
                    return (
                      <li
                        key={item.key}
                        className="rounded-md border border-line bg-surface p-3 text-sm break-inside-avoid"
                        data-kind={item.kind}
                      >
                        <p className="flex flex-wrap items-center gap-2">
                          <Badge tone={TONE[item.severity]}>{item.title}</Badge>
                          <span className="text-xs text-faint">
                            {CHECK_LABEL[item.check]}
                            {item.chapterTitle ? ` · ${item.chapterTitle}` : ''}
                            {item.shortRef ? ` · ${item.shortRef}` : ''}
                          </span>
                        </p>
                        <p className="mt-1.5 text-ink">{item.message}</p>
                        {link ? (
                          <Link
                            href={link.href}
                            className="mt-1.5 inline-block text-xs text-accent hover:underline print:hidden"
                          >
                            {link.label} →
                          </Link>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </>
      ) : error ? null : (
        <p className="mt-6 text-sm text-muted">Reading every citation…</p>
      )}
    </main>
  );
}
