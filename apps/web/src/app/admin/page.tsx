'use client';

/**
 * `/admin` — PRD §6.1, §11.5, §14. Empty in Phase 0 apart from the one thing PHASES task 0.10 and
 * PRD §0.3 rule 5 require: the header reads `Cost model: UNVERIFIED` until a human has filled
 * Appendix E.3 and flipped the `costModelVerified` flag. The real dashboard lands in week 4.
 *
 * SUPERADMIN gating arrives with the dashboard (PHASES 4.5); nothing here is sensitive yet — the
 * projected budget is the same number `pnpm ai:verify` prints.
 */

import { useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';

type CostModel = {
  verified: boolean;
  banner: string | null;
  projectedMonthlyInr: number;
  ceilingInr: number;
  withinCeiling: boolean;
};

export default function AdminPage() {
  const [model, setModel] = useState<CostModel | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<CostModel>('/admin/cost-model')
      .then(setModel)
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.problem.title : 'Could not reach the API.'),
      );
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
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
      <p className="mt-2 text-sm text-muted">
        Cost and telemetry dashboards arrive in Phase 1 week 4. Until then this page exists to show
        whether the cost model in PRD §11 has been verified against real provider numbers.
      </p>

      {error ? (
        <p role="alert" className="mt-6 text-sm text-warn">
          {error}
        </p>
      ) : model ? (
        <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border border-line bg-white p-4 text-sm">
          <dt className="text-muted">Cost model</dt>
          <dd>{model.verified ? 'Verified (Appendix E.3 filled)' : 'UNVERIFIED'}</dd>
          <dt className="text-muted">Projected cost, fully active STUDENT</dt>
          <dd>₹{model.projectedMonthlyInr.toFixed(2)} / month</dd>
          <dt className="text-muted">Ceiling (PRD §11)</dt>
          <dd>₹{model.ceilingInr} / month</dd>
          <dt className="text-muted">Within ceiling</dt>
          <dd>{model.withinCeiling ? 'Yes' : 'No — apply Appendix E.4 levers'}</dd>
        </dl>
      ) : (
        <p className="mt-6 text-sm text-muted">Loading…</p>
      )}
    </main>
  );
}
