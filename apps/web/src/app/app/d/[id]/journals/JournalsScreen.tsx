'use client';

/**
 * `/app/d/:id/journals` — where to submit the thesis (ADR-0040).
 *
 * A ranked list of journals, grounded on OpenAlex: each one's fit with the thesis's field and key
 * terms, how many of the thesis's own cited sources it published, and its OpenAlex citedness — no
 * invented impact factor, no AI in the ranking, no metered unit. Reads only. The student picks a
 * journal; this page never changes the thesis.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/primitives';
import { ApiError, api } from '@/lib/api';

type AlignmentLevel = 'subfield' | 'field' | 'domain' | 'none';
type ImpactTier = 'high' | 'medium' | 'emerging' | 'unknown';

type JournalScore = {
  journalId: string;
  name: string;
  publisher: string | null;
  issn: string[];
  eligible: boolean;
  reason: string;
  total: number;
  breakdown: { scope: number; citedHere: number; impact: number; access: number };
  alignmentLevel: AlignmentLevel;
  /** False when OpenAlex listed no subjects: then `none` means unknown, not "no overlap". */
  subjectsCompared: boolean;
  impactTier: ImpactTier;
  meanCitedness: number | null;
  citedHereCount: number;
  openAccess: boolean;
  inDoaj: boolean;
  apcUsd: number | null;
  overBudget: boolean;
};

type JournalsView = {
  basis: {
    keywords: string[];
    field: string | null;
    libraryVenueCount: number;
    citedVenueCount: number;
  };
  eligible: JournalScore[];
  ruledOut: JournalScore[];
  thin: boolean;
};

const ALIGNMENT_LABEL: Record<AlignmentLevel, string> = {
  subfield: 'Matches your subfield',
  field: 'Matches your field',
  domain: 'Same broad area',
  none: 'No subject overlap',
};

const IMPACT_LABEL: Record<ImpactTier, string> = {
  high: 'Highly cited',
  medium: 'Well cited',
  emerging: 'Emerging',
  unknown: 'Citedness unknown',
};

const IMPACT_TONE: Record<ImpactTier, 'ok' | 'accent' | 'neutral'> = {
  high: 'ok',
  medium: 'accent',
  emerging: 'neutral',
  unknown: 'neutral',
};

function JournalRow({ j }: { j: JournalScore }) {
  return (
    <li className="rounded-md border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-ink">{j.name}</p>
          <p className="mt-0.5 text-xs text-muted">
            {j.publisher ?? 'Publisher unknown'}
            {j.issn.length > 0 ? ` · ISSN ${j.issn.join(', ')}` : ''}
          </p>
        </div>
        {j.eligible ? (
          <span
            className="shrink-0 text-right text-sm font-bold tabular-nums text-ink"
            title="Overall fit, 0–100"
          >
            {j.total}
            <span className="block text-[10px] font-normal uppercase tracking-[0.05em] text-muted">
              fit
            </span>
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {j.alignmentLevel !== 'none' || j.subjectsCompared ? (
          <Badge tone={j.alignmentLevel === 'none' ? 'neutral' : 'accent'}>
            {ALIGNMENT_LABEL[j.alignmentLevel]}
          </Badge>
        ) : null}
        {j.citedHereCount > 0 ? (
          <Badge tone="ok">
            Published {j.citedHereCount} of your {j.citedHereCount === 1 ? 'source' : 'sources'}
          </Badge>
        ) : null}
        <Badge tone={IMPACT_TONE[j.impactTier]}>
          {IMPACT_LABEL[j.impactTier]}
          {j.meanCitedness !== null ? ` · ${j.meanCitedness.toFixed(1)}` : ''}
        </Badge>
        {j.inDoaj ? (
          <Badge tone="ok" className="uppercase">
            In DOAJ
          </Badge>
        ) : null}
        {j.openAccess ? <Badge tone="accent">Open access</Badge> : null}
        {j.apcUsd !== null ? (
          <Badge tone={j.overBudget ? 'warn' : 'neutral'}>
            APC ${j.apcUsd.toLocaleString()}
            {j.overBudget ? ' · over budget' : ''}
          </Badge>
        ) : null}
      </div>

      <p className="mt-2 text-xs text-muted">{j.reason}</p>
    </li>
  );
}

export function JournalsScreen({ documentId }: { documentId: string }) {
  const [view, setView] = useState<JournalsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openAccessOnly, setOpenAccessOnly] = useState(false);
  const [maxApc, setMaxApc] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (openAccessOnly) params.set('openAccess', '1');
      if (maxApc.trim() && Number.isFinite(Number(maxApc))) params.set('maxApc', maxApc.trim());
      const qs = params.toString();
      const next = await api<JournalsView>(
        `/documents/${documentId}/journals${qs ? `?${qs}` : ''}`,
      );
      setView(next);
    } catch (e) {
      setError(e instanceof ApiError ? e.problem.title : 'Could not match journals.');
    } finally {
      setLoading(false);
    }
  }, [documentId, openAccessOnly, maxApc]);

  // Load once on mount; re-run only when the student presses Apply (so a half-typed APC does not fire).
  // biome-ignore lint/correctness/useExhaustiveDependencies: filters apply on demand, not on keystroke
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

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
        / Journals
      </nav>
      <h1 className="mt-2 text-balance text-[28px] font-bold leading-tight tracking-[-0.02em] text-ink">
        Where to submit
      </h1>
      <p className="mt-1 text-sm text-muted">
        Journals ranked by fit with your topic and by how many of your sources each one published.
        Citedness is from OpenAlex, not an impact factor. Nothing here is advice to submit, and this
        page never changes your thesis.
      </p>

      <section className="mt-5 flex flex-wrap items-end gap-3 rounded-md border border-line bg-sunk p-3">
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={openAccessOnly}
            onChange={(e) => setOpenAccessOnly(e.target.checked)}
          />
          Open access only
        </label>
        <label className="flex items-center gap-2 text-sm text-ink">
          Max APC (USD)
          <input
            type="number"
            min={0}
            value={maxApc}
            onChange={(e) => setMaxApc(e.target.value)}
            placeholder="any"
            className="h-9 w-24 rounded-sm border border-line bg-surface px-2 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={() => void load()}
          className="h-9 rounded-sm bg-accent px-3 text-sm font-semibold text-accent-ink hover:opacity-90"
        >
          Apply
        </button>
      </section>

      {error ? (
        <p role="alert" className="mt-4 text-sm text-warn">
          {error}
        </p>
      ) : null}

      {loading && !view ? <p className="mt-6 text-sm text-muted">Matching journals…</p> : null}

      {view ? (
        <>
          <p className="mt-4 text-xs text-muted">
            Matched on {view.basis.field ? `${view.basis.field}, ` : ''}
            {view.basis.keywords.length} key {view.basis.keywords.length === 1 ? 'term' : 'terms'}
            {view.basis.libraryVenueCount > 0
              ? `, and the ${view.basis.libraryVenueCount} ${view.basis.libraryVenueCount === 1 ? 'journal' : 'journals'} your library’s sources come from`
              : ''}
            {view.basis.citedVenueCount > 0
              ? ` (you cite from ${view.basis.citedVenueCount} of them)`
              : ''}
            .
          </p>

          {view.thin ? (
            <p className="mt-6 rounded-md border border-line bg-surface p-4 text-sm text-muted">
              Not enough to match on yet. Add sources and resolve them in your{' '}
              <Link href={`/app/d/${documentId}/sources`} className="underline">
                library
              </Link>
              , then come back.
            </p>
          ) : null}

          {view.eligible.length > 0 ? (
            <ul className="mt-5 space-y-3">
              {view.eligible.map((j) => (
                <JournalRow key={j.journalId} j={j} />
              ))}
            </ul>
          ) : !view.thin ? (
            <p className="mt-6 text-sm text-muted">
              No journal cleared the fit bar for the current filters. Loosen the APC or open-access
              filter, or add more sources.
            </p>
          ) : null}

          {view.ruledOut.length > 0 ? (
            <details className="mt-6">
              <summary className="cursor-pointer text-sm font-semibold text-ink">
                Ruled out ({view.ruledOut.length})
              </summary>
              <ul className="mt-3 space-y-3">
                {view.ruledOut.map((j) => (
                  <JournalRow key={j.journalId} j={j} />
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
