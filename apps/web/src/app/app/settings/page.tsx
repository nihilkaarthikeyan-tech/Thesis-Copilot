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
import { LANGUAGES, type Language, tNow } from '@/i18n';
import { useLanguage, useT } from '@/i18n/react';
import { allowanceName, includedAllowances, notIncluded } from '@/lib/action-names';
import { ApiError, api } from '@/lib/api';

type Usage = {
  plan: string;
  resetsAt: string;
  actions: Array<{ action: string; used: number; cap: number; remaining: number }>;
};

type BeyondChoice = 'off' | 'ask' | 'on';
const BEYOND_CHOICES: ReadonlyArray<{ value: BeyondChoice; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'ask', label: 'Ask first' },
  { value: 'on', label: 'On' },
];

type Settings = {
  automaticSuggest?: boolean;
  autoCite?: boolean;
  autoSources?: boolean;
  emailWhenJobDone?: boolean;
  /** ADR-0060. The server answers "ask" until the student chooses. */
  searchBeyondLibrary?: BeyondChoice;
  defaultCitationStyle?: string | null;
  /** ADR-0061: the language of the screens, not of the thesis. */
  interfaceLanguage?: Language;
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [busy, setBusy] = useState(false);
  const [highContrast, setHighContrast] = useHighContrast();
  const { t, rich } = useT();
  const [language, setLanguage] = useLanguage();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api<Settings>('/settings')
      .then(setSettings)
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.problem.title : tNow('settings.loadError')),
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
      setError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : tNow('settings.saveError'),
      );
    } finally {
      setBusy(false);
    }
  }

  const assist = usage?.actions.find((a) => a.action === 'ASSIST');

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <nav className="text-xs text-muted">
        <Link href="/app" className="hover:underline">
          {t('common.theses')}
        </Link>{' '}
        / {t('common.settings')}
      </nav>
      <h1 className="mt-2 text-balance text-[28px] font-bold leading-tight tracking-[-0.02em] text-ink">
        {t('common.settings')}
      </h1>

      {error ? (
        <p role="alert" className="mt-4 text-sm text-warn">
          {error}
        </p>
      ) : null}

      <section className="mt-8 rounded-md border border-line bg-surface p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="eyebrow">{t('settings.language')}</h2>
            <p className="mt-1 text-sm text-muted">{t('settings.languageBody')}</p>
          </div>
          <select
            aria-label={t('settings.language')}
            data-testid="interface-language"
            value={language}
            onChange={(e) => {
              const next = e.target.value as Language;
              // The screen changes at once; the account keeps it for the next device.
              setLanguage(next);
              void save({ interfaceLanguage: next });
            }}
            className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
          >
            {LANGUAGES.map((option) => (
              <option key={option.id} value={option.id} lang={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="mt-6 rounded-md border border-line bg-surface p-4">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h2 className="eyebrow">{t('settings.auto.title')}</h2>
            <p className="mt-1 text-sm text-muted">
              {rich('settings.auto.body', { key: <kbd>Ctrl+/</kbd> })}
            </p>
            {settings ? (
              <p className="mt-2 text-sm text-muted" data-testid="auto-suggest-state">
                {settings.automaticSuggest ? t('settings.auto.on') : t('settings.auto.off')}
              </p>
            ) : null}
            <p className="mt-2 text-sm">
              <strong>{t('settings.auto.costLabel')}</strong>{' '}
              {rich('settings.auto.cost', { key: <kbd>Ctrl+/</kbd> })}
            </p>
            {assist ? (
              <p className="mt-2 text-sm text-muted" data-testid="assist-allowance">
                {t('settings.auto.allowance', {
                  used: assist.used,
                  cap: assist.cap,
                  remaining: assist.remaining,
                  date: usage ? new Date(usage.resetsAt).toLocaleDateString() : '—',
                })}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings?.automaticSuggest === true}
            aria-label={t('settings.auto.title')}
            disabled={busy || settings === null}
            onClick={() => void save({ automaticSuggest: settings?.automaticSuggest !== true })}
            data-testid="auto-suggest-toggle"
            className={`shrink-0 rounded-full px-3 py-1 text-xs ${
              settings?.automaticSuggest
                ? 'bg-accent text-accent-ink'
                : 'border border-line text-muted'
            }`}
          >
            {settings?.automaticSuggest ? t('common.on') : t('common.off')}
          </button>
        </div>
        {saved ? (
          <p role="status" className="mt-3 text-xs text-muted">
            {t('settings.saved')}
          </p>
        ) : null}
      </section>

      <section className="mt-6 rounded-md border border-line bg-surface p-4">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h2 className="eyebrow">{t('settings.cite.title')}</h2>
            <p className="mt-1 text-sm text-muted">{t('settings.cite.body')}</p>
            <p className="mt-2 text-sm">
              <strong>{t('settings.cite.groundedLabel')}</strong> {t('settings.cite.grounded')}
            </p>
            <p className="mt-2 text-sm text-muted">
              {rich('settings.cite.cost', {
                suggestions: <em>{t('settings.cite.suggestionsWord')}</em>,
              })}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings?.autoCite !== false}
            aria-label={t('settings.cite.title')}
            disabled={busy || settings === null}
            onClick={() => void save({ autoCite: settings?.autoCite === false })}
            data-testid="auto-cite-toggle"
            className={`shrink-0 rounded-full px-3 py-1 text-xs ${
              settings?.autoCite !== false
                ? 'bg-accent text-accent-ink'
                : 'border border-line text-muted'
            }`}
          >
            {settings?.autoCite !== false ? t('common.on') : t('common.off')}
          </button>
        </div>
      </section>

      <section className="mt-6 rounded-md border border-line bg-surface p-4">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h2 className="eyebrow">{t('settings.sources.title')}</h2>
            <p className="mt-1 text-sm text-muted">{t('settings.sources.body')}</p>
            <p className="mt-2 text-sm text-muted">{t('settings.sources.real')}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings?.autoSources !== false}
            aria-label={t('settings.sources.title')}
            disabled={busy || settings === null}
            onClick={() => void save({ autoSources: settings?.autoSources === false })}
            data-testid="auto-sources-toggle"
            className={`shrink-0 rounded-full px-3 py-1 text-xs ${
              settings?.autoSources !== false
                ? 'bg-accent text-accent-ink'
                : 'border border-line text-muted'
            }`}
          >
            {settings?.autoSources !== false ? t('common.on') : t('common.off')}
          </button>
        </div>
      </section>

      <section className="mt-6 rounded-md border border-line bg-surface p-4">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h2 className="eyebrow">Search beyond my library</h2>
            <p className="mt-1 text-sm text-muted">
              When you ask the chat something your library has nothing on, it can search OpenAlex,
              Semantic Scholar, PubMed and arXiv instead, read the abstracts of up to eight papers
              it finds, and answer from those — citing only them, each marked “Not in your library”
              with an Add button.
            </p>
            <p className="mt-2 text-sm text-muted">
              <strong>Ask first</strong> (the default) asks in the chat under a refused question —
              Allow this time, Always allow (which sets this to On) or Skip — and searches by itself
              when your library has little on a question; <strong>On</strong> searches on every
              library question and combines what it finds with your library’s passages;{' '}
              <strong>Off</strong> never searches. It counts as the same one chat question, and
              costs nothing if the search finds nothing to read.
            </p>
          </div>
          <fieldset
            data-testid="search-beyond-setting"
            className="inline-flex shrink-0 rounded-md border border-line bg-surface p-0.5"
          >
            <legend className="sr-only">Search beyond my library</legend>
            {BEYOND_CHOICES.map((choice) => {
              const current = settings?.searchBeyondLibrary ?? 'ask';
              return (
                <button
                  key={choice.value}
                  type="button"
                  aria-pressed={current === choice.value}
                  disabled={busy || settings === null}
                  data-testid={`search-beyond-${choice.value}`}
                  onClick={() => void save({ searchBeyondLibrary: choice.value })}
                  className={`rounded-sm px-2 py-0.5 text-xs font-semibold transition-colors ${
                    current === choice.value
                      ? 'bg-accent text-accent-ink'
                      : 'text-muted hover:text-ink'
                  }`}
                >
                  {choice.label}
                </button>
              );
            })}
          </fieldset>
        </div>
      </section>

      <section className="mt-6 rounded-md border border-line bg-surface p-4">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h2 className="eyebrow">{t('settings.email.title')}</h2>
            <p className="mt-1 text-sm text-muted">{t('settings.email.body')}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings?.emailWhenJobDone !== false}
            aria-label={t('settings.email.title')}
            disabled={busy || settings === null}
            onClick={() => void save({ emailWhenJobDone: settings?.emailWhenJobDone === false })}
            data-testid="job-email-toggle"
            className={`shrink-0 rounded-full px-3 py-1 text-xs ${
              settings?.emailWhenJobDone !== false
                ? 'bg-accent text-accent-ink'
                : 'border border-line text-muted'
            }`}
          >
            {settings?.emailWhenJobDone !== false ? t('common.on') : t('common.off')}
          </button>
        </div>
      </section>

      <section className="mt-6 rounded-md border border-line bg-surface p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="eyebrow">{t('settings.style.title')}</h2>
            <p className="mt-1 text-sm">{t('settings.style.body')}</p>
          </div>
          <select
            aria-label={t('settings.style.title')}
            data-testid="default-citation-style"
            disabled={busy || settings === null}
            value={settings?.defaultCitationStyle ?? ''}
            onChange={(e) => void save({ defaultCitationStyle: e.target.value || null })}
            className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
          >
            <option value="">{t('settings.style.default')}</option>
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
            <h2 className="eyebrow">{t('settings.contrast.title')}</h2>
            <p className="mt-1 text-sm">{t('settings.contrast.body')}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={highContrast}
            aria-label={t('settings.contrast.title')}
            data-testid="high-contrast"
            onClick={() => setHighContrast(!highContrast)}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
              highContrast ? 'bg-accent text-accent-ink' : 'border border-line text-muted'
            }`}
          >
            {highContrast ? t('common.on') : t('common.off')}
          </button>
        </div>
      </section>

      <section className="mt-6 rounded-md border border-line bg-surface p-4">
        <h2 className="eyebrow">{t('common.thisMonth')}</h2>
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
                {t('common.notIncluded', { list: notIncluded(usage.actions) })}
              </p>
            ) : null}
          </>
        ) : (
          <p className="mt-2 text-sm text-muted">{t('common.loading')}</p>
        )}
        <p className="mt-3 text-xs text-muted">{t('settings.month.note')}</p>
      </section>
    </main>
  );
}
