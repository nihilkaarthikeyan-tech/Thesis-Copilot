'use client';

/**
 * `/app/new` — the chooser (PHASES 6.3): "Path A vs Path B with one-line explanation each."
 *
 * Both paths end on the same proposal screen (FR-1.4); the choice is only where the first
 * material comes from — a paper the student has written, or a topic they describe.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import {
  StartingStyle,
  type StartingStyleChoice,
  saveStartingStyle,
  useDefaultStartingStyle,
} from '@/components/onboarding/StartingStyle';
import { Button } from '@/components/ui/button';
import type { MessageKey } from '@/i18n';
import { useT } from '@/i18n/react';
import { ApiError, api } from '@/lib/api';

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
  async function startWriting() {
    setBusy(true);
    setError(null);
    try {
      const document = await api<{ id: string; firstChapterId: string | null }>('/documents', {
        method: 'POST',
        body: JSON.stringify({ title: title.trim() || 'Untitled thesis', entryPath: 'A_TOPIC' }),
      });
      await saveStartingStyle(document.id, citationStyle);
      router.push(
        document.firstChapterId
          ? `/app/d/${document.id}/write/${document.firstChapterId}`
          : `/app/d/${document.id}/outline`,
      );
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not create it.',
      );
      setBusy(false);
    }
  }

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

      <form onSubmit={create} className="mt-6 space-y-4">
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

        <div className="flex flex-wrap items-center gap-3">
          {/* ADR-0070: writing first; the paper search starts from the title at once. */}
          <Button
            type="button"
            disabled={busy}
            onClick={() => void startWriting()}
            data-testid="start-writing-now"
          >
            {t('list.startWriting')}
          </Button>
          <Button type="submit" variant="secondary" disabled={busy || title.trim().length === 0}>
            {busy ? t('common.creating') : t('new.continue')}
          </Button>
          <Button
            type="submit"
            variant="secondary"
            data-word-import="true"
            disabled={busy || title.trim().length === 0}
          >
            {t('new.createImport')}
          </Button>
        </div>
        <p className="text-xs text-muted">{t('new.wordHint')}</p>
        <p className="text-xs text-muted">{t('list.startWritingHint')}</p>
      </form>
    </main>
  );
}
