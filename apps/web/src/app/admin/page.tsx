'use client';

/**
 * `/admin` — PRD §6.1, §9.4, §11.5, §14, PHASES 4.5 and 4.9.
 *
 * §14 names what belongs here: cost per user against ₹100, acceptance rate, cache hit rate,
 * hallucinated-cite rate, jobs failed. Every figure is read from `AiCallLog` and `SuggestionEvent`,
 * which record what happened, and the page says so where a number is not yet meaningful — the
 * cost is ₹0 on the mock provider, and pretending otherwise would defeat the point of a dashboard.
 *
 * The `Cost model: UNVERIFIED` banner from PHASES 0.10 stays until a human fills Appendix E.3.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';

type CostModel = {
  verified: boolean;
  banner: string | null;
  projectedMonthlyInr: number;
  ceilingInr: number;
  withinCeiling: boolean;
};

type CostRow = {
  action: string;
  calls: number;
  failed: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costInr: number;
  cacheHitRate: number;
};

type Costs = {
  from: string;
  to: string;
  rows: CostRow[];
  totalInr: number;
  users: number;
  perUserInr: number;
  ceilingInr: number;
  worstUserInr: number;
};

type Telemetry = {
  acceptance: Array<{ action: string; shown: number; accepted: number; rate: number }>;
  outcomes: Array<{ action: string; outcome: string; count: number }>;
  hallucinatedCiteRate: number;
  avgLatencyMs: Record<string, number>;
};

type Flag = { key: string; enabled: boolean; updatedAt: string };

/** What each flag does, from FR-9.7 and the seed, so a toggle is never a mystery switch. */
const FLAG_NOTES: Record<string, string> = {
  automaticSuggest: 'Suggestions fire 800 ms after a typing pause, per user opt-in (FR-4.6).',
  costModelVerified: 'Set only after pnpm ai:verify has filled Appendix E.3 (§0.3 rule 5).',
  draftModeStrongTier: 'Draft mode uses the Strong tier; off routes it to Fast (A.2, PHASES 4.9).',
  grobid: 'Use GROBID for PDF parsing instead of unpdf (§7.2).',
  livingGapMap: 'Recompute the gap map as the library changes (Phase 2).',
};

const inr = (value: number) => `₹${value.toFixed(2)}`;

export default function AdminPage() {
  const [model, setModel] = useState<CostModel | null>(null);
  const [costs, setCosts] = useState<Costs | null>(null);
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [flags, setFlags] = useState<Flag[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyFlag, setBusyFlag] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setModel(await api<CostModel>('/admin/cost-model'));
    } catch (e) {
      setError(e instanceof ApiError ? e.problem.title : 'Could not reach the API.');
      return;
    }
    try {
      const [c, t, f] = await Promise.all([
        api<Costs>('/admin/costs'),
        api<Telemetry>('/admin/telemetry'),
        api<Flag[]>('/admin/flags'),
      ]);
      setCosts(c);
      setTelemetry(t);
      setFlags(f);
    } catch (e) {
      // 401/403: the banner still shows, the numbers do not. That is the intended split.
      if (e instanceof ApiError && (e.problem.status === 401 || e.problem.status === 403)) {
        setForbidden(true);
      } else {
        setError(e instanceof Error ? e.message : 'Could not load the dashboards.');
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(flag: Flag) {
    setBusyFlag(flag.key);
    try {
      await api(`/admin/flags/${flag.key}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: !flag.enabled }),
      });
      setFlags(await api<Flag[]>('/admin/flags'));
    } catch (e) {
      setError(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not save.');
    } finally {
      setBusyFlag(null);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      {model && !model.verified ? (
        <div
          role="status"
          data-testid="cost-model-banner"
          className="mb-6 rounded-md border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn"
        >
          <strong>Cost model: UNVERIFIED.</strong>{' '}
          {model.banner?.replace(/^Cost model: UNVERIFIED — /, '')}
        </div>
      ) : null}

      <h1 className="font-serif text-2xl">Admin</h1>
      {flags ? (
        <p className="mt-1 text-sm">
          <Link href="/admin/users" className="underline">
            Pilot students
          </Link>{' '}
          <span className="text-muted">— usage, cost, caps and plan per account (PHASES 5.9).</span>
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-4 text-sm text-warn">
          {error}
        </p>
      ) : null}

      {forbidden ? (
        <p className="mt-4 text-sm text-muted">
          The dashboards are for administrators. The cost-model status above is public.
        </p>
      ) : null}

      {model ? (
        <section className="mt-8">
          <h2 className="font-serif text-lg">Cost model (PRD §11)</h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-line bg-surface p-4 text-sm md:grid-cols-4">
            <dt className="text-muted">Status</dt>
            <dd>{model.verified ? 'Verified' : 'UNVERIFIED'}</dd>
            <dt className="text-muted">Projected, fully active</dt>
            <dd>{inr(model.projectedMonthlyInr)} / month</dd>
            <dt className="text-muted">Ceiling</dt>
            <dd>{inr(model.ceilingInr)} / month</dd>
            <dt className="text-muted">Within ceiling</dt>
            <dd>{model.withinCeiling ? 'Yes' : 'No'}</dd>
          </dl>
        </section>
      ) : null}

      {costs ? (
        <section className="mt-8" data-testid="admin-costs">
          <h2 className="font-serif text-lg">What the AI cost this month</h2>
          <p className="mt-1 text-xs text-muted">
            From {costs.from.slice(0, 10)} to {costs.to.slice(0, 10)}, read from the call log.
            {costs.totalInr === 0 && costs.rows.some((r) => r.calls > 0)
              ? ' Cost is ₹0 because the provider is the mock; calls and tokens are real, the price is not.'
              : ''}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-line bg-surface p-4 text-sm md:grid-cols-4">
            <dt className="text-muted">Active users</dt>
            <dd>{costs.users}</dd>
            <dt className="text-muted">Total</dt>
            <dd>{inr(costs.totalInr)}</dd>
            <dt className="text-muted">Per user</dt>
            <dd className={costs.perUserInr > 90 ? 'text-warn' : ''}>
              {inr(costs.perUserInr)} of {inr(costs.ceilingInr)}
            </dd>
            <dt className="text-muted">Highest single user</dt>
            <dd className={costs.worstUserInr > 120 ? 'text-warn' : ''}>
              {inr(costs.worstUserInr)}
            </dd>
          </dl>
          <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Calls</th>
                  <th className="px-3 py-2">Failed</th>
                  <th className="px-3 py-2">Input</th>
                  <th className="px-3 py-2">Cached</th>
                  <th className="px-3 py-2">Output</th>
                  <th className="px-3 py-2">Cache hit</th>
                  <th className="px-3 py-2">Cost</th>
                </tr>
              </thead>
              <tbody>
                {costs.rows.map((row) => (
                  <tr key={row.action} className="border-t border-line">
                    <td className="px-3 py-2 font-medium">{row.action}</td>
                    <td className="px-3 py-2">{row.calls}</td>
                    <td className={`px-3 py-2 ${row.failed > 0 ? 'text-warn' : ''}`}>
                      {row.failed}
                    </td>
                    <td className="px-3 py-2">{row.inputTokens.toLocaleString()}</td>
                    <td className="px-3 py-2">{row.cachedInputTokens.toLocaleString()}</td>
                    <td className="px-3 py-2">{row.outputTokens.toLocaleString()}</td>
                    <td
                      className={`px-3 py-2 ${row.action === 'ASSIST' && row.calls > 0 && row.cacheHitRate < 70 ? 'text-warn' : ''}`}
                    >
                      {row.calls > 0 ? `${row.cacheHitRate}%` : '–'}
                    </td>
                    <td className="px-3 py-2">{inr(row.costInr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {telemetry ? (
        <section className="mt-8" data-testid="admin-telemetry">
          <h2 className="font-serif text-lg">What students did with it</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-line bg-surface p-4 text-sm">
              <p className="text-xs text-muted">Acceptance (FR-9.4)</p>
              {telemetry.acceptance.length === 0 ? (
                <p className="mt-1 text-muted">No suggestions yet.</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {telemetry.acceptance.map((a) => (
                    <li key={a.action} className="flex justify-between">
                      <span>{a.action}</span>
                      <span>
                        {a.accepted} of {a.shown} kept · {a.rate}%
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-lg border border-line bg-surface p-4 text-sm">
              <p className="text-xs text-muted">Guardrails (§10.6, §14)</p>
              <ul className="mt-1 space-y-1">
                <li className="flex justify-between">
                  <span>Hallucinated-cite rate</span>
                  <span className={telemetry.hallucinatedCiteRate > 1 ? 'text-warn' : ''}>
                    {telemetry.hallucinatedCiteRate}%{' '}
                    {telemetry.hallucinatedCiteRate > 1 ? '(alert: over 1%)' : ''}
                  </span>
                </li>
                {Object.entries(telemetry.avgLatencyMs).map(([action, ms]) => (
                  <li key={action} className="flex justify-between">
                    <span>Mean latency, {action}</span>
                    <span>{ms} ms</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      ) : null}

      {flags ? (
        <section className="mt-8" data-testid="admin-flags">
          <h2 className="font-serif text-lg">Feature flags (FR-9.7)</h2>
          <p className="mt-1 text-xs text-muted">
            Read at request time and cached for a minute; a toggle here is live within that.
          </p>
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface">
            {flags.map((flag) => (
              <li
                key={flag.key}
                className="flex items-center justify-between gap-4 px-4 py-3 text-sm"
              >
                <div>
                  <p className="font-mono">{flag.key}</p>
                  <p className="text-xs text-muted">{FLAG_NOTES[flag.key] ?? ''}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={flag.enabled}
                  aria-label={`${flag.key}: ${flag.enabled ? 'on' : 'off'}`}
                  disabled={busyFlag === flag.key}
                  onClick={() => void toggle(flag)}
                  className={`shrink-0 rounded-full px-3 py-1 text-xs ${
                    flag.enabled ? 'bg-ink text-paper' : 'border border-line text-muted'
                  }`}
                >
                  {flag.enabled ? 'On' : 'Off'}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!model && !error ? <p className="mt-6 text-sm text-muted">Loading…</p> : null}
    </main>
  );
}
