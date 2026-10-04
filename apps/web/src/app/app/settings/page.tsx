'use client';

/**
 * `/app/settings` — PRD FR-4.6, FR-9.2, PHASES v2 W9.3.
 *
 *   "per-user setting, 800 ms idle trigger with the B.3 conditions; same cap; setting screen
 *    explains cost in cap units."
 *
 * The cost is stated in the unit the student is actually charged in — one Assist suggestion, out
 * of the month's allowance — next to the counter that shows how much of it is left. Nothing here
 * changes what a suggestion costs; it changes how often one is asked for, which is exactly the
 * thing a student needs told before they switch it on.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { STARTING_STYLES } from '@/components/onboarding/StartingStyle';
import { useHighContrast } from '@/components/theme';
import { allowanceName, includedAllowances, notIncluded } from '@/lib/action-names';
import { ApiError, api } from '@/lib/api';

type Usage = {
  plan: string;
  resetsAt: string;
  actions: Array<{ action: string; used: number; cap: number; remaining: number }>;
};

type Settings = {
  automaticSuggest?: boolean;
  autoCite?: boolean;
  autoSources?: boolean;
  defaultCitationStyle?: string | null;
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [busy, setBusy] = useState(false);
  const [highContrast, setHighContrast] = useHighContrast();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api<Settings>('/settings')
      .then(setSettings)
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.problem.title : 'Could not load your settings.'),
      );
    api<Usage>('/usage/me')
      .then(setUsage)
      .catch(() => undefined);
  }, []);

  async function save(patch: Partial<Settings>) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await api<Settings>('/settings', {
        method: 'PUT',
        body: JSON.stringify(patch),
      });
      setSettings(updated);
      setSaved(true);
    } catch (e) {
      setError(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  const assist = usage?.actions.find((a) => a.action === 'ASSIST');

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <nav className="text-xs text-muted">
        <Link href="/app" className="hover:underline">
          Theses
        </Link>{' '}
        / Settings
      </nav>
      <h1 className="mt-2 text-balance text-[28px] font-bold leading-tight tracking-[-0.02em] text-ink">
        Settings
      </h1>

      {error ? (
        <p role="alert" className="mt-4 text-sm text-warn">
          {error}
        </p>
      ) : null}

      <section className="mt-8 rounded-md border border-line bg-surface p-4">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h2 className="eyebrow">Suggest without my asking</h2>
            <p className="mt-1 text-sm text-muted">
              When this is on, a suggestion appears about a second after you stop typing, instead of
              only when you press <kbd>Ctrl+/</kbd>. It never interrupts you mid-word, and it never
              fires while a suggestion is already showing.
            </p>
            {settings ? (
              <p className="mt-2 text-sm text-muted" data-testid="auto-suggest-state">
                {settings.automaticSuggest
                  ? 'It is on for you now. Turn it off here whenever you would rather ask for each suggestion yourself.'
                  : 'It is off for you now. Turn it on here if you would like suggestions without asking.'}
              </p>
            ) : null}
            <p className="mt-2 text-sm">
              <strong>What it costs:</strong> every suggestion counts as one Assist action, whether
              you keep it or dismiss it — the same as pressing <kbd>Ctrl+/</kbd> yourself. Leaving
              this on typically spends the month's allowance several times faster.
            </p>
            {assist ? (
              <p className="mt-2 text-sm text-muted" data-testid="assist-allowance">
                You have used {assist.used} of {assist.cap} Assist suggestions this month —{' '}
                {assist.remaining} left, resetting on{' '}
                {usage ? new Date(usage.resetsAt).toLocaleDateString() : '—'}.
              </p>
            ) : null}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings?.automaticSuggest === true}
            aria-label="Suggest without my asking"
            disabled={busy || settings === null}
            onClick={() => void save({ automaticSuggest: settings?.automaticSuggest !== true })}
            data-testid="auto-suggest-toggle"
            className={`shrink-0 rounded-full px-3 py-1 text-xs ${
              settings?.automaticSuggest
                ? 'bg-accent text-accent-ink'
                : 'border border-line text-muted'
            }`}
          >
            {settings?.automaticSuggest ? 'On' : 'Off'}
          </button>
        </div>
        {saved ? (
          <p role="status" className="mt-3 text-xs text-muted">
            Saved. It takes effect the next time you open a chapter.
          </p>
        ) : null}
      </section>

      <section className="mt-6 rounded-md border border-line bg-surface p-4">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h2 className="eyebrow">Cite my library automatically</h2>
            <p className="mt-1 text-sm text-muted">
              On by default. When a suggestion draws on a paper in your library, it arrives with the
              citation already attached, so you can see which source it came from.
            </p>
            <p className="mt-2 text-sm">
              <strong>Turning this off does not make suggestions less grounded.</strong> Your
              sources are still what the suggestion is written from and it still may not claim
              anything they do not say — you simply get the sentence without the marker, and add the
              citation yourself.
            </p>
            <p className="mt-2 text-sm text-muted">
              Costs nothing either way. Citation <em>suggestions</em>, which you ask for with the
              cite button, are a separate action and are unaffected.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings?.autoCite !== false}
            aria-label="Cite my library automatically"
            disabled={busy || settings === null}
            onClick={() => void save({ autoCite: settings?.autoCite === false })}
            data-testid="auto-cite-toggle"
            className={`shrink-0 rounded-full px-3 py-1 text-xs ${
              settings?.autoCite !== false
                ? 'bg-accent text-accent-ink'
                : 'border border-line text-muted'
            }`}
          >
            {settings?.autoCite !== false ? 'On' : 'Off'}
          </button>
        </div>
      </section>

      <section className="mt-6 rounded-md border border-line bg-surface p-4">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h2 className="eyebrow">Find sources for me</h2>
            <p className="mt-1 text-sm text-muted">
              On by default. When nothing in your library covers what you are writing, we search
              OpenAlex, Semantic Scholar, arXiv and PubMed for papers on it and add the few that are
              clearly on topic to your library, marked “Added automatically”. Your suggestions can
              then cite them.
            </p>
            <p className="mt-2 text-sm text-muted">
              Every paper added is a real, published record you can open and check, and you can
              remove any of them from your library. A few searches a month are included in your
              plan.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings?.autoSources !== false}
            aria-label="Find sources for me"
            disabled={busy || settings === null}
            onClick={() => void save({ autoSources: settings?.autoSources === false })}
            data-testid="auto-sources-toggle"
            className={`shrink-0 rounded-full px-3 py-1 text-xs ${
              settings?.autoSources !== false
                ? 'bg-accent text-accent-ink'
                : 'border border-line text-muted'
            }`}
          >
            {settings?.autoSources !== false ? 'On' : 'Off'}
          </button>
        </div>
      </section>

      <section className="mt-6 rounded-md border border-line bg-surface p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="eyebrow">Citation style for new theses</h2>
            <p className="mt-1 text-sm">
              Chosen for you when you start a thesis; you can still change it there or in the
              Citations tab. Theses you already have keep their own style.
            </p>
          </div>
          <select
            aria-label="Citation style for new theses"
            data-testid="default-citation-style"
            disabled={busy || settings === null}
            value={settings?.defaultCitationStyle ?? ''}
            onChange={(e) => void save({ defaultCitationStyle: e.target.value || null })}
            className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
          >
            <option value="">APA 7 (the default)</option>
            {STARTING_STYLES.filter((style) => style.id !== 'apa').map((style) => (
              <option key={style.id} value={style.id}>
                {style.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="mt-6 rounded-md border border-line bg-surface p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="eyebrow">High contrast</h2>
            <p className="mt-1 text-sm">
              Darker text and stronger lines, in light or dark. Kept on this device only.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={highContrast}
            aria-label="High contrast"
            data-testid="high-contrast"
            onClick={() => setHighContrast(!highContrast)}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
              highContrast ? 'bg-accent text-accent-ink' : 'border border-line text-muted'
            }`}
          >
            {highContrast ? 'On' : 'Off'}
          </button>
        </div>
      </section>

      <section className="mt-6 rounded-md border border-line bg-surface p-4">
        <h2 className="eyebrow">This month</h2>
        {usage ? (
          <>
            <ul className="mt-2 space-y-1 text-sm" data-testid="usage-list">
              {includedAllowances(usage.actions).map((a) => (
                <li key={a.action} className="flex items-baseline justify-between gap-4">
                  <span>{allowanceName(a.action)}</span>
                  <span className={a.remaining === 0 ? 'text-warn' : 'text-muted'}>
                    {a.used} / {a.cap}
                  </span>
                </li>
              ))}
            </ul>
            {notIncluded(usage.actions) ? (
              <p className="mt-2 text-xs text-muted">
                Not included in your plan: {notIncluded(usage.actions)}.
              </p>
            ) : null}
          </>
        ) : (
          <p className="mt-2 text-sm text-muted">Loading…</p>
        )}
        <p className="mt-3 text-xs text-muted">
          Everything the AI does for you is counted here and nowhere else. Dismissing a suggestion
          still counts: the text was written before you saw it.
        </p>
      </section>
    </main>
  );
}
