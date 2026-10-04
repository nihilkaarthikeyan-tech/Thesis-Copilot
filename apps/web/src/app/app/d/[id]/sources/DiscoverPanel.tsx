'use client';

/**
 * The "Discover" tab — PRD FR-2.5–2.8, PHASES v2 W7.3.
 *
 *   "run a search, per-theme lists as a grid (thin flagged), select candidates → the resolve/index
 *    pipeline. Nothing is selected automatically."
 *
 * The worker does the searching; this starts a run, polls it, shows the gap map as a grid of
 * themes, and sends only what the student ticked.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, api } from '@/lib/api';

type Candidate = {
  id: string;
  title: string;
  abstract: string | null;
  year: number | null;
  venue: string | null;
  doi: string | null;
  citationCount: number | null;
  isPreprint: boolean;
  oaStatus: string | null;
  score: number | null;
  selected: boolean;
};

type Run = {
  runId: string;
  mode: 'discover' | 'expand';
  status: 'RUNNING' | 'DONE' | 'FAILED';
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  counts: Record<string, number>;
  /** The worker's current step while RUNNING; null for older runs. */
  stage?: string | null;
  queries: Array<{ angle: string; q: string }>;
  /** Present once the `livingGapMap` flag is on: how many of this theme the student kept. */
  themes: Array<{
    name: string;
    thin: boolean;
    libraryCount?: number;
    /** ADR-0041: grounded relevance-vs-coverage reading of the theme. */
    signal?: {
      relevance: number;
      relevanceRank: number;
      coverage: number;
      medianCitations: number | null;
      candidateCount: number;
      gapScore: number;
      gapClass: 'open' | 'active' | 'crowded' | 'peripheral' | 'sparse';
    };
    /** ADR-0046: what OpenAlex counts for the theme's own query, year by year. */
    density?: {
      query: string;
      total: number;
      recent: number;
      previous: number;
      trend: 'rising' | 'steady' | 'falling' | null;
      perYear: Array<{ year: number; count: number }>;
    };
    candidates: Candidate[];
  }>;
};

const TREND: Record<'rising' | 'steady' | 'falling', string> = {
  rising: 'growing',
  steady: 'steady',
  falling: 'slowing',
};

/** "12,400" — a count as a student reads it. */
const count = (n: number) => n.toLocaleString('en-IN');

/**
 * ADR-0046: the theme's real publication density, from OpenAlex, with a sparkline of the years.
 * The query is shown and links to OpenAlex, so the number can be checked rather than trusted.
 */
function Density({ density }: { density: NonNullable<Run['themes'][number]['density']> }) {
  const years = density.perYear.slice(-10);
  const max = Math.max(1, ...years.map((y) => y.count));
  // The same filter the count was taken with, so the number on OpenAlex's page is this one.
  const href = `https://openalex.org/works?filter=${encodeURIComponent(`title_and_abstract.search:${density.query}`)}`;
  return (
    <div data-testid="theme-density" className="mt-1 flex items-end gap-2 text-xs text-muted">
      {years.length > 1 ? (
        <span aria-hidden="true" className="flex h-4 items-end gap-px">
          {years.map((y) => (
            <span
              key={y.year}
              title={`${y.year}: ${count(y.count)}`}
              className="w-1 rounded-sm bg-accent/60"
              style={{ height: `${Math.max(8, Math.round((y.count / max) * 100))}%` }}
            />
          ))}
        </span>
      ) : null}
      <span>
        <a href={href} target="_blank" rel="noopener noreferrer" className="underline">
          {count(density.total)} papers
        </a>{' '}
        on OpenAlex with “{density.query}” in the title or abstract
        {density.trend
          ? ` · ${TREND[density.trend]} (${count(density.recent)} in the last three years, ${count(density.previous)} in the three before)`
          : ''}
      </span>
    </div>
  );
}

const GAP_LABEL: Record<
  NonNullable<Run['themes'][number]['signal']>['gapClass'],
  { text: string; tone: string }
> = {
  open: { text: 'Open gap', tone: 'bg-ok-soft text-ok' },
  active: { text: 'Active area', tone: 'bg-accent-soft text-accent' },
  crowded: { text: 'Crowded', tone: 'bg-sunk text-muted' },
  peripheral: { text: 'Peripheral', tone: 'bg-sunk text-muted' },
  sparse: { text: 'Too few to tell', tone: 'bg-warn-soft text-warn' },
};

const GAP_BLURB: Record<NonNullable<Run['themes'][number]['signal']>['gapClass'], string> = {
  open: 'Relevant to your thesis but thinly covered — a gap worth pursuing.',
  active: 'Relevant and already well covered — a live conversation to join.',
  crowded: 'A large body of work only loosely related to your scope.',
  peripheral: 'Little literature and loosely related.',
  sparse: 'Too few papers here to read a relevance from — a real gap, or a dead end.',
};

/** The worker's steps (`SearchStage`), in order, in the student's words. */
const STAGES: Array<{ key: string; label: string }> = [
  { key: 'queries', label: 'Writing searches from your proposal' },
  { key: 'searching', label: 'Searching OpenAlex, Semantic Scholar, PubMed and arXiv' },
  { key: 'filtering', label: 'Keeping the papers closest to your topic' },
  { key: 'themes', label: 'Grouping them into themes' },
  { key: 'saving', label: 'Saving the map' },
];

/**
 * A running search, step by step with a clock (2026-10-04). It used to say "Searching…" and a row
 * of raw counts for a minute and a half, which reads as stuck.
 */
function SearchProgress({ run }: { run: Run }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.round((now - Date.parse(run.startedAt)) / 1_000));
  const current = STAGES.findIndex((s) => s.key === run.stage);
  const found = run.counts.fetched ?? 0;
  return (
    <div className="mt-8 text-sm" data-testid="search-running" role="status">
      <p className="font-medium">
        Searching · {seconds} s{' '}
        <span className="font-normal text-muted">(usually about a minute)</span>
      </p>
      <ol className="mt-3 space-y-1">
        {STAGES.map((stage, i) => {
          const done = current > i;
          const active = current === i || (current === -1 && i === 0);
          return (
            <li key={stage.key} className={done || active ? 'text-ink' : 'text-faint'}>
              <span aria-hidden="true">{done ? '✓' : active ? '•' : '○'}</span> {stage.label}
              {stage.key === 'searching' && done && found > 0 ? ` — ${found} papers found` : ''}
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-xs text-muted">
        You can leave this page; the results are kept here when you come back.
      </p>
    </div>
  );
}

type RunSummary = { runId: string; mode: 'discover' | 'expand'; status: string; startedAt: string };

const POLL_MS = 2_500;

export function DiscoverPanel({
  documentId,
  hasLibrary,
  onAdded,
}: {
  documentId: string;
  /** Path B expansion needs resolved sources to expand from. */
  hasLibrary: boolean;
  onAdded: () => void;
}) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<'discover' | 'expand' | 'select' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadRun = useCallback(
    async (runId: string) => {
      try {
        setRun(await api<Run>(`/documents/${documentId}/search/${runId}`));
      } catch (e) {
        setError(e instanceof ApiError ? e.problem.title : 'Could not load that search.');
      }
    },
    [documentId],
  );

  useEffect(() => {
    api<RunSummary[]>(`/documents/${documentId}/search`)
      .then((list) => {
        setRuns(list);
        const latest = list[0];
        if (latest) void loadRun(latest.runId);
      })
      .catch(() => setRuns([]));
  }, [documentId, loadRun]);

  // Poll while the worker is searching.
  const running = run?.status === 'RUNNING';
  useEffect(() => {
    if (!running || !run) return;
    const timer = setInterval(() => void loadRun(run.runId), POLL_MS);
    return () => clearInterval(timer);
  }, [running, run, loadRun]);

  async function start(mode: 'discover' | 'expand') {
    setBusy(mode);
    setError(null);
    setNotice(null);
    setPicked(new Set());
    try {
      const { runId } = await api<{ runId: string }>(`/documents/${documentId}/search`, {
        method: 'POST',
        body: JSON.stringify({ mode }),
      });
      setRuns((r) => [
        { runId, mode, status: 'RUNNING', startedAt: new Date().toISOString() },
        ...(r ?? []),
      ]);
      await loadRun(runId);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? (e.problem.detail ?? e.problem.title)
          : 'Could not start the search.',
      );
    } finally {
      setBusy(null);
    }
  }

  async function addSelected() {
    if (!run || picked.size === 0) return;
    setBusy('select');
    setError(null);
    try {
      const result = await api<{ added: number; alreadyPresent: number }>(
        `/documents/${documentId}/search/${run.runId}/select`,
        { method: 'POST', body: JSON.stringify({ candidateIds: [...picked] }) },
      );
      setNotice(
        `${result.added} added to the library${result.alreadyPresent ? ` (${result.alreadyPresent} already there)` : ''}. They are being looked up and indexed.`,
      );
      setPicked(new Set());
      await loadRun(run.runId);
      onAdded();
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not add them.',
      );
    } finally {
      setBusy(null);
    }
  }

  const total = useMemo(() => run?.themes.reduce((n, t) => n + t.candidates.length, 0) ?? 0, [run]);

  return (
    <section className="mt-6" data-testid="discover">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy !== null || running}
          onClick={() => void start('discover')}
          className="rounded-md px-4 py-2 text-sm disabled:opacity-50 bg-accent text-accent-ink hover:bg-accent-hover font-semibold transition-colors"
        >
          {busy === 'discover' ? 'Starting…' : 'Discover literature'}
        </button>
        <button
          type="button"
          disabled={busy !== null || running || !hasLibrary}
          onClick={() => void start('expand')}
          title={
            hasLibrary
              ? 'Papers that cite, or are related to, your resolved sources'
              : 'Needs resolved sources first'
          }
          className="rounded-md border border-line-strong bg-surface px-4 py-2 text-sm disabled:opacity-50 font-semibold text-ink transition-colors hover:bg-sunk"
        >
          {busy === 'expand' ? 'Starting…' : 'Expand from my citations'}
        </button>
        {runs && runs.length > 1 ? (
          <select
            className="ml-auto rounded-md border border-line-strong bg-surface px-2 py-1 text-xs font-semibold text-ink transition-colors hover:bg-sunk"
            value={run?.runId ?? ''}
            onChange={(e) => void loadRun(e.target.value)}
          >
            {runs.map((r) => (
              <option key={r.runId} value={r.runId}>
                {r.mode} · {new Date(r.startedAt).toLocaleString()}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      <p className="mt-2 text-xs text-muted">
        One search costs one Strong call and one Fast call; nothing enters your library until you
        add it. Results come from OpenAlex, last 15 years, articles, preprints and chapters.
      </p>

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mt-4 text-sm">
          {notice}
        </p>
      ) : null}

      {!run ? (
        <p className="mt-8 rounded-lg border border-dashed border-line p-8 text-center text-sm text-muted">
          No search yet. Discover starts from your saved proposal.
        </p>
      ) : run.status === 'RUNNING' ? (
        <SearchProgress run={run} />
      ) : run.status === 'FAILED' ? (
        <p role="alert" className="mt-8 text-sm text-warn">
          The search did not finish: {run.error}
        </p>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-baseline justify-between gap-3 text-sm">
            <p className="text-muted" data-testid="search-summary">
              {total} candidates in {run.themes.length} theme{run.themes.length === 1 ? '' : 's'}
              {run.themes.some((t) => t.thin)
                ? ` · ${run.themes.filter((t) => t.thin).length} thin`
                : ''}
              {run.queries.length > 0
                ? ` · queries: ${run.queries.map((q) => `“${q.q}”`).join(', ')}`
                : ''}
            </p>
            <button
              type="button"
              disabled={picked.size === 0 || busy !== null}
              onClick={() => void addSelected()}
              className="rounded-md px-4 py-2 disabled:opacity-50 bg-accent text-accent-ink hover:bg-accent-hover font-semibold transition-colors"
              data-testid="add-selected"
            >
              {busy === 'select' ? 'Adding…' : `Add ${picked.size} to the library`}
            </button>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2" data-testid="gap-map">
            {run.themes.map((theme) => (
              <section
                key={theme.name}
                data-testid="theme"
                data-thin={theme.thin}
                className={`rounded-lg border p-3 ${theme.thin ? 'border-warn/50 bg-warn/5' : 'border-line bg-surface'}`}
              >
                <h3 className="flex items-baseline justify-between gap-2 text-sm font-medium">
                  <span className="flex items-center gap-2">
                    {theme.name}
                    {theme.signal ? (
                      <span
                        data-testid="gap-class"
                        data-gap-class={theme.signal.gapClass}
                        title={GAP_BLURB[theme.signal.gapClass]}
                        className={`inline-flex items-center rounded-sm px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.05em] ${GAP_LABEL[theme.signal.gapClass].tone}`}
                      >
                        {GAP_LABEL[theme.signal.gapClass].text}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs text-muted">
                    {theme.libraryCount === undefined
                      ? theme.candidates.length
                      : `${theme.libraryCount} of ${theme.candidates.length} kept`}
                    {theme.thin ? ' · thin' : ''}
                  </span>
                </h3>
                {theme.density ? <Density density={theme.density} /> : null}
                {theme.signal && theme.signal.gapClass !== 'sparse' ? (
                  <p className="mt-1 text-xs text-muted">
                    {GAP_BLURB[theme.signal.gapClass]}
                    {theme.signal.medianCitations !== null
                      ? ` Median ${theme.signal.medianCitations} citations.`
                      : ''}
                  </p>
                ) : null}
                {theme.thin ? (
                  <p className="mt-1 text-xs text-warn">
                    {theme.libraryCount === undefined
                      ? 'Fewer than four papers found here — a gap, or a topic to search again with other words.'
                      : 'Fewer than four of these are in your library — either a real gap, or a theme you have not curated yet.'}
                  </p>
                ) : null}
                <ul className="mt-2 space-y-2">
                  {theme.candidates.map((c) => (
                    <li key={c.id} className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        aria-label={`Select ${c.title}`}
                        className="mt-1"
                        disabled={c.selected}
                        checked={c.selected || picked.has(c.id)}
                        onChange={(e) => {
                          const next = new Set(picked);
                          if (e.target.checked) next.add(c.id);
                          else next.delete(c.id);
                          setPicked(next);
                        }}
                      />
                      <div className="min-w-0">
                        <p className={c.selected ? 'text-muted' : ''}>
                          {c.title}
                          {c.selected ? (
                            <span className="ml-1 text-xs text-muted">(in library)</span>
                          ) : null}
                        </p>
                        <p className="text-xs text-muted">
                          {[
                            c.year,
                            c.venue,
                            c.citationCount !== null ? `${c.citationCount} citations` : null,
                            c.isPreprint ? 'preprint' : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                          {c.doi ? (
                            <>
                              {' · '}
                              <a
                                href={`https://doi.org/${c.doi}`}
                                target="_blank"
                                rel="noreferrer"
                                className="underline"
                              >
                                {c.doi}
                              </a>
                            </>
                          ) : null}
                        </p>
                        {c.abstract ? (
                          <p className="mt-1 line-clamp-2 text-xs text-muted">{c.abstract}</p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
