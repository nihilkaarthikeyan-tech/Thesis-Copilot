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
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { signOut, useSession } from '@/lib/auth-client';

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

type Budget = {
  ceilingInr: number | null;
  source: 'admin' | 'env' | 'none';
  spentInr: number;
  period: string;
  resetsAt: string;
  reached: boolean;
  warning: boolean;
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

/** Each switch in plain words, so a toggle is never a mystery. */
const FLAG_NAMES: Record<string, string> = {
  automaticSuggest: 'Suggest without being asked',
  collaboration: 'Live co-authoring',
  costModelVerified: 'Cost figures confirmed',
  draftModeStrongTier: 'Draft mode on the stronger model',
  grobid: 'GROBID PDF reader',
  livingGapMap: 'Living gap map',
};
const FLAG_NOTES: Record<string, string> = {
  automaticSuggest:
    'A suggestion appears 0.8 s after a student pauses typing, for students who opt in. Off: only when they ask.',
  collaboration:
    'Two people can write one chapter at the same time. Needs the server step in docs/PENDING.md first.',
  costModelVerified:
    'Turn on once a person has checked the projected cost per student against the real provider bills.',
  draftModeStrongTier:
    'Draft mode uses the stronger, dearer model. Off routes drafts to the fast model.',
  grobid: 'Read uploaded PDFs with the GROBID service instead of the built-in reader.',
  livingGapMap: 'Recompute the literature gap map whenever the library changes.',
};

const inr = (value: number) => `₹${value.toFixed(2)}`;

export default function AdminPage() {
  const router = useRouter();
  const session = useSession();
  const signedInAs = session.data?.user.email ?? null;
  const [model, setModel] = useState<CostModel | null>(null);
  const [costs, setCosts] = useState<Costs | null>(null);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [budgetInput, setBudgetInput] = useState('');
  const [budgetBusy, setBudgetBusy] = useState(false);
  const [budgetNotice, setBudgetNotice] = useState<string | null>(null);
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
      api<Budget>('/admin/platform-budget')
        .then((b) => {
          setBudget(b);
          setBudgetInput(b.ceilingInr === null ? '' : String(b.ceilingInr));
        })
        .catch(() => undefined);
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
    <div className="min-h-dvh">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-baseline gap-2">
            <Link href="/" className="font-serif text-[16px] font-semibold tracking-tight">
              Thesis Copilot
            </Link>
            <span className="text-faint" aria-hidden="true">
              /
            </span>
            <span className="text-sm font-semibold text-ink">Admin</span>
          </div>
          <nav
            className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm"
            data-testid="admin-nav"
          >
            <Link href="/admin/users" className="hover:underline">
              Users
            </Link>
            <Link href="/app" className="hover:underline">
              Your theses
            </Link>
            {signedInAs ? (
              <span className="text-xs text-muted" data-testid="admin-signed-in">
                Signed in as {signedInAs}
              </span>
            ) : null}
            <button
              type="button"
              className="rounded-md border border-line-strong px-2 py-1 text-xs font-semibold text-ink hover:bg-sunk"
              onClick={() => signOut().then(() => router.replace('/sign-in'))}
            >
              Sign out
            </button>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        {model && !model.verified ? (
          <div
            role="status"
            data-testid="cost-model-banner"
            className="mb-6 rounded-md border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn"
          >
            <strong>Cost figures not yet confirmed by a person.</strong> The projected cost per
            student below comes from the price tables. Once you have checked it against a real
            provider bill, turn on “Cost figures confirmed” under Feature switches.
          </div>
        ) : null}

        <h1 className="text-balance font-serif text-[27px] font-semibold leading-tight text-ink">
          Admin
        </h1>
        {flags ? (
          <p className="mt-1 text-sm">
            <Link href="/admin/users" className="underline">
              Users
            </Link>{' '}
            <span className="text-muted">
              — every account, with its usage, cost, allowances, plan and role.
            </span>
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="mt-4 text-sm text-warn">
            {error}
          </p>
        ) : null}

        {forbidden ? (
          <p className="mt-4 text-sm text-muted">
            These screens are for administrators.{' '}
            <Link href="/sign-in" className="underline">
              Sign in
            </Link>{' '}
            with an administrator’s address to see them.
          </p>
        ) : null}

        {model ? (
          <section className="mt-8">
            <h2 className="text-balance font-serif text-[17px] font-semibold leading-snug text-ink">
              What one student can cost us
            </h2>
            <p className="mt-1 text-xs text-muted">
              The worst case: a student who uses every AI allowance every month, priced at the
              models this site runs.
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 rounded-md border border-line bg-surface p-4 text-sm md:grid-cols-4">
              <dt className="text-muted">Projected cost per student</dt>
              <dd>{inr(model.projectedMonthlyInr)} / month</dd>
              <dt className="text-muted">Hard limit per student</dt>
              <dd>{inr(model.ceilingInr)} / month</dd>
              <dt className="text-muted">Within the limit</dt>
              <dd>{model.withinCeiling ? 'Yes' : 'No'}</dd>
              <dt className="text-muted">Confirmed by a person</dt>
              <dd>{model.verified ? 'Yes' : 'Not yet'}</dd>
            </dl>
          </section>
        ) : null}

        {budget ? (
          <section className="mt-8" data-testid="platform-budget">
            <h2 className="text-balance font-serif text-[17px] font-semibold leading-snug text-ink">
              Site-wide AI budget
            </h2>
            <p className="mt-1 text-xs text-muted">
              One number for the whole site per calendar month. At it, every AI call is refused and
              the paper indexing pauses until the 1st; you are emailed at 80% and at the stop. The
              per-student ₹100 limit applies regardless.
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 rounded-md border border-line bg-surface p-4 text-sm md:grid-cols-4">
              <dt className="text-muted">Spent in {budget.period}</dt>
              <dd className={budget.reached ? 'text-warn' : budget.warning ? 'text-warn' : ''}>
                {inr(budget.spentInr)}
              </dd>
              <dt className="text-muted">Budget</dt>
              <dd data-testid="platform-budget-ceiling">
                {budget.ceilingInr === null ? 'Off' : `${inr(budget.ceilingInr)} / month`}
                {budget.source === 'env' ? ' (from the server settings)' : ''}
              </dd>
              <dt className="text-muted">Status</dt>
              <dd>{budget.reached ? 'REACHED — AI paused' : budget.warning ? 'Past 80%' : 'OK'}</dd>
              <dt className="text-muted">Resets</dt>
              <dd>{budget.resetsAt.slice(0, 10)}</dd>
            </dl>
            <form
              className="mt-3 flex flex-wrap items-end gap-2"
              onSubmit={async (event) => {
                event.preventDefault();
                setBudgetBusy(true);
                setBudgetNotice(null);
                try {
                  const value = budgetInput.trim() === '' ? null : Number(budgetInput);
                  const next = await api<Budget>('/admin/platform-budget', {
                    method: 'PUT',
                    body: JSON.stringify({ ceilingInr: value }),
                  });
                  setBudget(next);
                  setBudgetNotice(
                    next.ceilingInr === null
                      ? 'Site-wide budget switched off. Logged.'
                      : `Site-wide budget set to ${inr(next.ceilingInr)} a month. Logged.`,
                  );
                } catch (e) {
                  setBudgetNotice(
                    e instanceof ApiError
                      ? (e.problem.detail ?? e.problem.title)
                      : 'Could not save.',
                  );
                } finally {
                  setBudgetBusy(false);
                }
              }}
            >
              <label className="text-xs text-muted" htmlFor="platform-budget-inr">
                Budget in rupees per month (blank = off)
                <input
                  id="platform-budget-inr"
                  data-testid="platform-budget-input"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={budgetInput}
                  onChange={(e) => setBudgetInput(e.target.value)}
                  className="mt-1 block w-40 rounded-md border border-line-strong bg-surface px-2 py-1 text-sm text-ink"
                />
              </label>
              <button
                type="submit"
                disabled={budgetBusy}
                data-testid="platform-budget-save"
                className="rounded-md border border-line-strong bg-surface px-3 py-1 text-sm font-semibold text-ink transition-colors hover:bg-sunk disabled:opacity-50"
              >
                {budgetBusy ? 'Saving…' : 'Save budget'}
              </button>
              {budgetNotice ? (
                <span role="status" data-testid="platform-budget-notice" className="text-xs">
                  {budgetNotice}
                </span>
              ) : null}
            </form>
          </section>
        ) : null}

        {costs ? (
          <section className="mt-8" data-testid="admin-costs">
            <h2 className="text-balance font-serif text-[17px] font-semibold leading-snug text-ink">
              What the AI cost this month
            </h2>
            <p className="mt-1 text-xs text-muted">
              From {costs.from.slice(0, 10)} to {costs.to.slice(0, 10)}, read from the call log.
              {costs.totalInr === 0 && costs.rows.some((r) => r.calls > 0)
                ? ' Cost is ₹0 because the provider is the mock; calls and tokens are real, the price is not.'
                : ''}
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 rounded-md border border-line bg-surface p-4 text-sm md:grid-cols-4">
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
            <div className="mt-3 overflow-x-auto rounded-md border border-line bg-surface">
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
            <h2 className="text-balance font-serif text-[17px] font-semibold leading-snug text-ink">
              What students did with it
            </h2>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="rounded-md border border-line bg-surface p-4 text-sm">
                <p className="text-xs text-muted">Suggestions kept</p>
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
              <div className="rounded-md border border-line bg-surface p-4 text-sm">
                <p className="text-xs text-muted">Safety and speed</p>
                <ul className="mt-1 space-y-1">
                  <li className="flex justify-between">
                    <span>Made-up citations caught</span>
                    <span className={telemetry.hallucinatedCiteRate > 1 ? 'text-warn' : ''}>
                      {telemetry.hallucinatedCiteRate}%{' '}
                      {telemetry.hallucinatedCiteRate > 1 ? '(alert: over 1%)' : ''}
                    </span>
                  </li>
                  {Object.entries(telemetry.avgLatencyMs).map(([action, ms]) => (
                    <li key={action} className="flex justify-between">
                      <span>Average wait, {action}</span>
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
            <h2 className="text-balance font-serif text-[17px] font-semibold leading-snug text-ink">
              Feature switches
            </h2>
            <p className="mt-1 text-xs text-muted">
              A change here is live for everyone within a minute.
            </p>
            <ul className="mt-3 divide-y divide-line rounded-md border border-line bg-surface">
              {flags.map((flag) => (
                <li
                  key={flag.key}
                  className="flex items-center justify-between gap-4 px-4 py-3 text-sm"
                >
                  <div>
                    <p className="font-medium">
                      {FLAG_NAMES[flag.key] ?? flag.key}{' '}
                      <span className="font-mono text-xs text-faint">{flag.key}</span>
                    </p>
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
                      flag.enabled ? 'bg-accent text-accent-ink' : 'border border-line text-muted'
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
    </div>
  );
}
