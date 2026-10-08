'use client';

/**
 * `/app/new` — the chooser (PHASES 6.3): "Path A vs Path B with one-line explanation each."
 *
 * Both paths end on the same proposal screen (FR-1.4); the choice is only where the first
 * material comes from — a paper the student has written, or a topic they describe.
 */

import type { SourcePrefs } from '@tc/types';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import {
  STARTING_STYLES,
  StartingStyle,
  type StartingStyleChoice,
  saveStartingStyle,
  useDefaultStartingStyle,
} from '@/components/onboarding/StartingStyle';
import { StartQuestions } from '@/components/onboarding/StartQuestions';
import { StartSetup, type Structure } from '@/components/onboarding/StartSetup';
import { Button } from '@/components/ui/button';
import type { MessageKey } from '@/i18n';
import { useT } from '@/i18n/react';
import { ApiError, api } from '@/lib/api';
import { readNewStart } from '@/lib/thesis-href';

type EntryPath = 'A_TOPIC' | 'B_PAPER';

const PATHS: Array<{ value: EntryPath; name: MessageKey; line: MessageKey; next: MessageKey }> = [
  { value: 'B_PAPER', name: 'new.paper.name', line: 'new.paper.line', next: 'new.paper.next' },
  { value: 'A_TOPIC', name: 'new.topic.name', line: 'new.topic.line', next: 'new.topic.next' },
];

export default function NewThesisPage() {
  const router = useRouter();
  const { t } = useT();
  const [entryPath, setEntryPath] = useState<EntryPath>('B_PAPER');
  const [title, setTitle] = useState('');
  const [citationStyle, setCitationStyle] = useState<StartingStyleChoice>('');
  useDefaultStartingStyle(citationStyle, setCitationStyle);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** ADR-0087: the preference and structure steps after the title. */
  const [setupOpen, setSetupOpen] = useState(false);
  /** ADR-0091: the thesis just made with Smart headings, while its start questions are open. */
  const [questions, setQuestions] = useState<{ documentId: string; path: string } | null>(null);
  /**
   * R32 (ADR-0127): the New ▾ menu arrives with `?start=topic|paper|word`, the starting point
   * already chosen. `word` puts "Create and import from Word" first. Read from `window` after
   * mount, as the list's `?new=1` is, rather than `useSearchParams` and a Suspense boundary.
   */
  const [wordFirst, setWordFirst] = useState(false);
  useEffect(() => {
    const start = readNewStart(window.location.search);
    if (start === 'paper') setEntryPath('B_PAPER');
    if (start === 'topic' || start === 'word') setEntryPath('A_TOPIC');
    setWordFirst(start === 'word');
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    // "Create and import from Word" (2026-10-04): the thesis opens on its chapter with the import
    // dialog up, for a student whose chapters are already written in Word.
    const fromWord =
      (event.nativeEvent as SubmitEvent).submitter?.getAttribute('data-word-import') === 'true';
    setBusy(true);
    setError(null);
    try {
      const document = await api<{ id: string; firstChapterId: string | null }>('/documents', {
        method: 'POST',
        body: JSON.stringify({ title: title.trim(), entryPath }),
      });
      await saveStartingStyle(document.id, citationStyle);
      router.push(
        fromWord && document.firstChapterId
          ? `/app/d/${document.id}/write/${document.firstChapterId}?import=word`
          : `/app/d/${document.id}/proposal`,
      );
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : t('new.createError'),
      );
      setBusy(false);
    }
  }

  /**
   * ADR-0062 (ADR-0059 row 2): "Start writing now" — no proposal, no title needed, straight into
   * a blank first chapter. `A_TOPIC` whatever is ticked above: there is no paper to read, and the
   * topic path's proposal can start from the student's own words when they come back to it.
   */
  async function startWriting(sourcePrefs?: SourcePrefs, structure?: Structure) {
    setBusy(true);
    setError(null);
    try {
      const document = await api<{ id: string; firstChapterId: string | null }>('/documents', {
        method: 'POST',
        // ADR-0072: `start: 'writing'` plans the chapters from the title in the background.
        // ADR-0087: with the preferences and structure from the setup steps.
        body: JSON.stringify({
          title: title.trim() || 'Untitled thesis',
          entryPath: 'A_TOPIC',
          start: 'writing',
          ...(sourcePrefs ? { sourcePrefs } : {}),
          ...(structure ? { structure } : {}),
          // ADR-0091: Smart headings ask a few questions first; the chapters wait for them.
          ...(structure === 'smart' ? { askFirst: true } : {}),
        }),
      });
      await saveStartingStyle(document.id, citationStyle);
      const editorPath = document.firstChapterId
        ? `/app/d/${document.id}/write/${document.firstChapterId}`
        : `/app/d/${document.id}/outline`;
      if (structure === 'smart') {
        // ADR-0091: the questions, on this screen, before the editor.
        setQuestions({ documentId: document.id, path: editorPath });
        setBusy(false);
        return;
      }
      router.push(editorPath);
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not create it.',
      );
      setBusy(false);
    }
  }

  const importButton = (
    <Button
      type="submit"
      variant={wordFirst ? undefined : 'secondary'}
      data-word-import="true"
      data-testid="create-import-word"
      disabled={busy || title.trim().length === 0}
    >
      {t('new.createImport')}
    </Button>
  );

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <nav className="text-xs text-muted">
        <Link href="/app" className="hover:underline">
          {t('common.theses')}
        </Link>{' '}
        / {t('new.crumb')}
      </nav>
      <h1 className="mt-2 text-balance text-[28px] font-bold leading-tight tracking-[-0.02em] text-ink">
        {t('new.heading')}
      </h1>

      {setupOpen ? (
        <div className="mt-6 flex flex-col gap-4">
          <button
            type="button"
            onClick={() => setSetupOpen(false)}
            className="self-end rounded-md bg-sunk px-3 py-2 text-left text-[13px] text-ink"
          >
            {title.trim() || 'Untitled thesis'}
            <span className="ml-2 text-muted underline">Edit</span>
          </button>
          {questions ? (
            <StartQuestions
              documentId={questions.documentId}
              title={title.trim() || 'Untitled thesis'}
              onDone={() => router.push(questions.path)}
            />
          ) : (
            <StartSetup
              stylePicker={<StartingStyle value={citationStyle} onChange={setCitationStyle} />}
              styleName={
                STARTING_STYLES.find((s) => s.id === citationStyle)?.label ?? 'Default style'
              }
              busy={busy}
              error={error}
              onBack={() => setSetupOpen(false)}
              onStart={(prefs, structure) => void startWriting(prefs, structure)}
            />
          )}
        </div>
      ) : (
        <form onSubmit={create} className="mt-6 space-y-4">
          {wordFirst ? (
            <p
              className="rounded-md border border-accent/40 bg-accent-soft px-3 py-2 text-sm text-ink"
              data-testid="new-word-start"
            >
              {t('new.wordStart')}
            </p>
          ) : null}
          <fieldset className="space-y-3">
            <legend className="sr-only">{t('new.startingPoint')}</legend>
            {PATHS.map((path) => (
              <label
                key={path.value}
                className={`block cursor-pointer rounded-lg border p-4 ${
                  entryPath === path.value ? 'border-ink bg-surface' : 'border-line bg-paper'
                }`}
              >
                <span className="flex items-start gap-3">
                  <input
                    type="radio"
                    name="entryPath"
                    value={path.value}
                    checked={entryPath === path.value}
                    onChange={() => setEntryPath(path.value)}
                    className="mt-1"
                  />
                  <span>
                    <span className="block font-medium">{t(path.name)}</span>
                    <span className="block text-sm text-muted">{t(path.line)}</span>
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="rounded-md border border-line bg-surface p-4">
            <label className="text-sm" htmlFor="title">
              {t('common.workingTitle')}
            </label>
            <input
              id="title"
              name="title"
              required
              maxLength={300}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-line px-3 text-sm"
              placeholder={
                entryPath === 'A_TOPIC' ? t('new.placeholderTopic') : t('new.placeholderPaper')
              }
            />
            <p className="mt-1 text-xs text-muted">
              {t(PATHS.find((p) => p.value === entryPath)?.next ?? 'new.paper.next')}{' '}
              {t('new.titleLater')}
            </p>
          </div>

          <div className="rounded-md border border-line bg-surface p-4">
            <StartingStyle value={citationStyle} onChange={setCitationStyle} />
          </div>

          {error ? (
            <p role="alert" className="text-sm text-warn">
              {error}
            </p>
          ) : null}

          {/* With `?start=word` the Word button comes first in the page as well as on screen, so
              Enter (which presses the first submit button) imports rather than plans. */}
          <div className="flex flex-wrap items-center gap-3">
            {wordFirst ? importButton : null}
            {/* ADR-0070: writing first; the paper search starts from the title at once. */}
            <Button
              type="button"
              variant={wordFirst ? 'secondary' : undefined}
              disabled={busy}
              onClick={() => setSetupOpen(true)}
              data-testid="start-writing-now"
            >
              {t('list.startWriting')}
            </Button>
            <Button type="submit" variant="secondary" disabled={busy || title.trim().length === 0}>
              {busy ? t('common.creating') : t('new.continue')}
            </Button>
            {wordFirst ? null : importButton}
          </div>
          <p className="text-xs text-muted">{t('new.wordHint')}</p>
          <p className="text-xs text-muted">{t('list.startWritingHint')}</p>
        </form>
      )}
    </main>
  );
}
