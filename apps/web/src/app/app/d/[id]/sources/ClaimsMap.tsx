'use client';

/**
 * The claims map — ADR-0086: what the library's papers claim, how well each claim is supported,
 * which papers contrast, and what a thesis could do about it. Beside the gap map, which reasons
 * over counts; this one reasons over claims. One strong-model pass, once an hour per thesis.
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';

type Claim = {
  claim: string;
  status: 'well-supported' | 'contested' | 'under-explored';
  supporting: string[];
  contrasting: string[];
  direction: string;
  limits: string;
};

type ClaimsMapData = {
  computedAt: string;
  papers: Array<{ id: string; title: string; year: number | null }>;
  claims: Claim[];
};

const STATUS: Record<Claim['status'], { label: string; className: string }> = {
  'well-supported': { label: 'Well supported', className: 'border-ok/50 text-ok' },
  contested: { label: 'Contested', className: 'border-warn/50 text-warn' },
  'under-explored': { label: 'Under-explored', className: 'border-accent/50 text-accent' },
};

const ORDER: Claim['status'][] = ['under-explored', 'contested', 'well-supported'];

export function ClaimsMap({ documentId }: { documentId: string }) {
  const [map, setMap] = useState<ClaimsMapData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ map: ClaimsMapData | null }>(`/documents/${documentId}/claims`);
      setMap(res.map);
    } catch {
      // The gap map above still works; the claims map is an addition.
    }
  }, [documentId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ map: ClaimsMapData }>(`/documents/${documentId}/claims`, {
        method: 'POST',
        body: '{}',
      });
      setMap(res.map);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? (e.problem.detail ?? e.problem.title)
          : 'The claims could not be mapped. Try again in a minute.',
      );
    } finally {
      setBusy(false);
    }
  }

  const titleOf = (id: string) => {
    const paper = map?.papers.find((p) => p.id === id);
    if (!paper) return id;
    const short = paper.title.length > 48 ? `${paper.title.slice(0, 48)}…` : paper.title;
    return paper.year ? `${short} (${paper.year})` : short;
  };

  return (
    <section className="mt-8 border-t border-line pt-4" data-testid="claims-map">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h3 className="eyebrow">Claims in your library</h3>
          <p className="mt-1 text-xs text-muted">
            What the papers claim, how well each claim is supported, which papers contrast, and what
            your thesis could do about it. Read from up to thirty papers; once an hour.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run()}
          data-testid="claims-run"
          className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-sunk disabled:opacity-50"
        >
          {busy ? 'Reading…' : map ? 'Map the claims again' : 'Map the claims'}
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-warn">
          {error}
        </p>
      ) : null}
      {map ? (
        <>
          <p className="mt-2 text-xs text-muted" data-testid="claims-summary">
            {map.claims.length} claim{map.claims.length === 1 ? '' : 's'} from {map.papers.length}{' '}
            paper{map.papers.length === 1 ? '' : 's'}, mapped{' '}
            {new Date(map.computedAt).toLocaleString()}.
          </p>
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {[...map.claims]
              .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status))
              .map((c) => (
                <li
                  key={c.claim}
                  data-testid="claim"
                  data-status={c.status}
                  className={`rounded-md border bg-surface p-3 text-sm ${STATUS[c.status].className}`}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-wide">
                    {STATUS[c.status].label}
                  </p>
                  <p className="mt-1 text-ink">{c.claim}</p>
                  <p className="mt-2 text-xs text-muted">
                    <span className="font-medium text-ink">For:</span>{' '}
                    {c.supporting.map(titleOf).join(' · ')}
                  </p>
                  {c.contrasting.length > 0 ? (
                    <p className="mt-1 text-xs text-muted">
                      <span className="font-medium text-ink">Against:</span>{' '}
                      {c.contrasting.map(titleOf).join(' · ')}
                    </p>
                  ) : null}
                  {c.direction ? (
                    <p className="mt-2 text-xs text-ink">
                      <span className="font-medium">A direction:</span> {c.direction}
                    </p>
                  ) : null}
                  {c.limits ? (
                    <p className="mt-1 text-xs text-muted">
                      <span className="font-medium text-ink">Limits:</span> {c.limits}
                    </p>
                  ) : null}
                </li>
              ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
