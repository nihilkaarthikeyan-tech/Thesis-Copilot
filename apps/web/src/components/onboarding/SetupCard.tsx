'use client';

/**
 * ADR-0145: "Set up this thesis", inside the editor, as Jenni sets a new document up in its own
 * editor. New opens the first chapter at once; this card sits at the top of the empty chapter,
 * between the status line and the toolbar, and takes the student through five rows:
 *
 * 1. **Title** — the working title, the citation style chips and a folded Sources line whose
 *    Change opens today's `SourcePrefsFields`; links to the other starts (a paper, Word, a full
 *    proposal). Next names the thesis, which starts the paper search (ADR-0070).
 * 2. **Field** — field (guessed from the title in code, no model) and university; optional.
 * 3. **Aim** — today's start questions (ADR-0091), one at a time (`SetupAim`).
 * 4. **Chapters** — the plan appears in place: the chapter list fills and Chapter 1's sections
 *    become headings on the page (the section guide lays them). Keep these chapters · Standard
 *    chapters · No headings · Edit the outline.
 * 5. **First line** — the cited opener (ADR-0078) waits under the first heading; accepting it or
 *    writing a sentence finishes the card.
 *
 * Each finished row folds to one line with Edit or Change. Finish later folds the whole card into
 * the status line, whose Show (and ⋯ → First steps) brings it back. The state is
 * `Document.meta.setup`; every write goes through `PUT /documents/:id/setup`. Every other call is
 * a route the start screens already used: no new prompt, no new metered action.
 */

import { DISCIPLINE_PROFILES, suggestDiscipline, UNIVERSITY_PROFILES } from '@tc/config';
import {
  namesATopic,
  readSourcePrefs,
  type SetupCard as SetupState,
  type SetupStep,
  type SetupUpdate,
  type SourcePrefs,
  setupStepNumber,
  UNTITLED_THESIS,
} from '@tc/types';
import { getGhostState } from '@tc/ui';
import type { Editor } from '@tiptap/core';
import { Check, Circle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { CHAPTER_REPLACED_META, type PlanState } from '@/components/editor/SectionGuide';
import { OPEN_WORD_IMPORT } from '@/components/editor/WordImport';
import { LimitNotice, useLimit } from '@/components/LimitNotice';
import {
  STARTING_STYLES,
  StartingStyle,
  type StartingStyleChoice,
  saveStartingStyle,
} from '@/components/onboarding/StartingStyle';
import { SourcePrefsFields } from '@/components/sources/SourcePrefsFields';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n/react';
import { ApiError, api } from '@/lib/api';
import { bodyWords, FIRST_LINE_WORDS, firstLinePosition, sourcesLine } from '@/lib/setup-card';
import { cn } from '@/lib/utils';
import { SetupAim } from './SetupAim';

export type SetupDoc = {
  id: string;
  title: string;
  meta?: unknown;
  field?: string | null;
  citationStyle?: string;
  chapters: Array<{ id: string; title: string }>;
};

type SetupView = {
  setup: SetupState;
  title: string;
  field: string | null;
  universityId: string | null;
};

function problem(e: unknown, fallback: string): string {
  return e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : fallback;
}

function styleLabel(id: string | null | undefined): string | null {
  if (!id) return null;
  return STARTING_STYLES.find((s) => s.id === id)?.label ?? id;
}

/** One row: a tick (or a ring), its name, what was chosen, and Edit or Change. */
function Row({
  id,
  state,
  label,
  value,
  action,
  children,
}: {
  id: SetupStep | 'sources';
  state: 'done' | 'open' | 'pending';
  label: string;
  value?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      data-testid={`setup-row-${id}`}
      data-state={state}
      className={cn(
        'flex min-w-0 gap-3 px-4',
        state === 'open' ? 'border-y border-line bg-paper py-3' : 'py-1.5',
      )}
    >
      <span aria-hidden="true" className="mt-[3px] w-4 shrink-0">
        {state === 'done' ? (
          <Check className="size-4 text-accent" strokeWidth={2.25} />
        ) : (
          <Circle
            className={cn('size-3.5', state === 'open' ? 'text-accent' : 'text-faint')}
            strokeWidth={state === 'open' ? 3 : 2}
          />
        )}
      </span>
      {state === 'open' ? (
        <div className="min-w-0 flex-1">{children}</div>
      ) : (
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5 sm:flex-nowrap">
          <span
            className={cn(
              'w-full shrink-0 text-[13px] sm:w-20',
              state === 'done' ? 'text-muted' : 'text-faint',
            )}
          >
            {label}
          </span>
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-[13px]',
              state === 'done' ? 'text-ink' : 'text-faint',
            )}
            title={typeof value === 'string' ? value : undefined}
          >
            {value}
          </span>
          {action ? <span className="shrink-0 text-[12.5px]">{action}</span> : null}
        </div>
      )}
    </div>
  );
}

function LinkButton(props: {
  onClick: () => void;
  children: ReactNode;
  testId?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      data-testid={props.testId}
      className="text-muted underline underline-offset-2 hover:text-ink disabled:opacity-60"
    >
      {props.children}
    </button>
  );
}

export function SetupCard({
  doc,
  chapterId,
  editor,
  card,
  onCard,
  onDocChanged,
  onPlanStarted,
  plan,
  autoSuggest,
  placement,
}: {
  doc: SetupDoc;
  chapterId: string;
  editor: Editor | null;
  card: SetupState;
  onCard: (next: SetupState) => void;
  /** The title, field or chapters changed on the server: read the document again. */
  onDocChanged: () => void;
  /** A plan was asked for: the chapter list and the section guide look again until it lands. */
  onPlanStarted: () => void;
  /** The section guide's reading of the plan (ADR-0137). */
  plan: PlanState;
  /** The student's automatic-suggest setting: on, the opener asks by itself. */
  autoSuggest: boolean;
  /** Above the toolbar while it is being set up; inside the status line's Show once folded. */
  placement: 'top' | 'line';
}) {
  const { t } = useT();
  const router = useRouter();
  /** A finished row reopened with Edit or Change; null shows the card's own open row. */
  const [reopened, setReopened] = useState<'title' | 'field' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const limit = useLimit();

  const meta = (doc.meta as Record<string, unknown> | null) ?? {};
  const [title, setTitle] = useState(doc.title === UNTITLED_THESIS ? '' : doc.title);
  const [style, setStyle] = useState<StartingStyleChoice>(
    (STARTING_STYLES.some((s) => s.id === doc.citationStyle)
      ? doc.citationStyle
      : '') as StartingStyleChoice,
  );
  const [prefs, setPrefs] = useState<SourcePrefs>(() => readSourcePrefs(doc.meta));
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [prefsValid, setPrefsValid] = useState(true);
  const guessed = suggestDiscipline(null, doc.title);
  const [field, setField] = useState<string>(doc.field ?? guessed?.displayName ?? '');
  const [universityId, setUniversityId] = useState<string>(
    typeof meta.universityId === 'string' ? meta.universityId : '',
  );
  // The guess follows the title until the field row has been answered.
  useEffect(() => {
    if (card.step === 'title' && !doc.field) {
      setField(suggestDiscipline(null, title)?.displayName ?? '');
    }
  }, [title, card.step, doc.field]);

  /** The one open row: one reopened with Edit or Change, else the card's own, none when done. */
  const open: SetupStep | null = reopened ?? (card.done ? null : card.step);

  async function save(update: SetupUpdate): Promise<SetupView | null> {
    setBusy(true);
    setError(null);
    try {
      const view = await api<SetupView>(`/documents/${doc.id}/setup`, {
        method: 'PUT',
        body: JSON.stringify(update),
      });
      onCard(view.setup);
      return view;
    } catch (e) {
      setError(problem(e, t('setup.error')));
      return null;
    } finally {
      setBusy(false);
    }
  }

  // ---- Row 1: title, style and sources -----------------------------------------------------
  const titleReady = namesATopic(title);
  async function confirmTitle(event?: FormEvent) {
    event?.preventDefault();
    if (!titleReady || !prefsValid) return;
    await saveStartingStyle(doc.id, style);
    const view = await save({
      title: title.trim(),
      sourcePrefs: prefs,
      ...(reopened ? {} : { step: 'field' as const }),
    });
    if (!view) return;
    setReopened(null);
    setPrefsOpen(false);
    onDocChanged();
  }

  async function toProposal() {
    if (titleReady) await save({ title: title.trim(), dismissed: true });
    else await save({ dismissed: true });
    router.push(`/app/d/${doc.id}/proposal`);
  }

  // ---- Row 2: field and university ---------------------------------------------------------
  async function confirmField(skip: boolean) {
    const view = await save({
      ...(skip ? {} : { field: field || null, universityId: universityId || null }),
      ...(reopened ? {} : { step: 'aim' as const }),
    });
    if (!view) return;
    setReopened(null);
    if (!skip) onDocChanged();
  }

  // ---- Row 3 → 4: the chapters are on their way --------------------------------------------
  const autoSuggestRef = useRef(autoSuggest);
  autoSuggestRef.current = autoSuggest;
  /**
   * The cursor on the first empty line under a heading, and the opener asked for (ADR-0078):
   * by itself when automatic suggestions are on, else asked here once. If the plan lands later
   * and the sentence was accepted, the section guide lays the headings around it.
   */
  function offerFirstLine() {
    if (!editor || editor.isDestroyed) return;
    if (bodyWords(editor.state.doc) >= FIRST_LINE_WORDS) return;
    const at = firstLinePosition(editor.state.doc);
    if (at === null) return;
    editor.chain().setTextSelection(at).focus().scrollIntoView().run();
    const ask = () => {
      if (editor.isDestroyed) return;
      if ((getGhostState(editor)?.status ?? 'idle') !== 'idle') return;
      if (bodyWords(editor.state.doc) >= FIRST_LINE_WORDS) return;
      editor.chain().focus().requestSuggestion().run();
    };
    // With automatic suggestions the opener asks on its own; this is the fallback if it did not.
    window.setTimeout(ask, autoSuggestRef.current ? 2_500 : 300);
  }

  async function planned(aim: NonNullable<SetupState['aim']>) {
    const view = await save({ aim, step: 'chapters' });
    if (!view) return;
    onPlanStarted();
    onDocChanged();
    offerFirstLine();
  }

  async function noPlan() {
    const view = await save({ chapters: 'none', step: 'first' });
    if (view) offerFirstLine();
  }

  // ---- Row 4: keep, or replace while nothing is written ------------------------------------
  async function keep() {
    const view = await save({ chapters: 'planned', step: 'first' });
    if (view) offerFirstLine();
  }

  async function restart(structure: 'standard' | 'none') {
    setBusy(true);
    setError(null);
    limit.clear();
    try {
      const outline = await api<{ chapters: Array<{ id: string; title: string }> }>(
        `/documents/${doc.id}/outline/restart`,
        { method: 'POST', body: JSON.stringify({ structure, chapterId }) },
      );
      const first = outline.chapters.find((c) => c.id === chapterId) ?? outline.chapters[0];
      // The chapter on screen is the new first chapter: its title and one empty line, saved by
      // autosave as the server now has it.
      if (editor && !editor.isDestroyed && first) {
        // Marked, so a section layout still waiting for the old plan drops itself (SectionGuide).
        editor
          .chain()
          .setMeta(CHAPTER_REPLACED_META, true)
          .setContent({
            type: 'doc',
            content: [
              {
                type: 'heading',
                attrs: { level: 1 },
                content: [{ type: 'text', text: first.title }],
              },
              { type: 'paragraph' },
            ],
          })
          .run();
      }
      setBusy(false);
      const view = await save({ chapters: structure, step: 'first' });
      onPlanStarted();
      onDocChanged();
      if (view) offerFirstLine();
    } catch (e) {
      if (!limit.take(e)) setError(problem(e, t('setup.error')));
      setBusy(false);
    }
  }

  async function retryPlan() {
    setBusy(true);
    setError(null);
    limit.clear();
    try {
      await api(`/documents/${doc.id}/outline/plan-from-title`, { method: 'POST', body: '{}' });
      onPlanStarted();
    } catch (e) {
      if (!limit.take(e)) setError(problem(e, t('setup.chapters.failed')));
    } finally {
      setBusy(false);
    }
  }

  // ---- Row 5: the first line is written ------------------------------------------------------
  // biome-ignore lint/correctness/useExhaustiveDependencies: `save` is a fresh closure each render; the listener only needs the latest card.
  useEffect(() => {
    if (!editor || card.done || card.step !== 'first') return;
    let finished = false;
    const check = () => {
      if (finished || editor.isDestroyed) return;
      if (bodyWords(editor.state.doc) < FIRST_LINE_WORDS) return;
      finished = true;
      void save({ done: true, dismissed: false });
    };
    check();
    editor.on('update', check);
    return () => {
      editor.off('update', check);
    };
  }, [editor, card.done, card.step]);

  // ---- Drawing -------------------------------------------------------------------------------
  const sources = sourcesLine(prefs, styleLabel(style || doc.citationStyle), t);
  const fieldValue = [
    doc.field ?? (card.step === 'title' ? null : t('setup.field.notSet')),
    UNIVERSITY_PROFILES.find((u) => u.id === meta.universityId)?.displayName ??
      t('setup.university.notSet'),
  ]
    .filter(Boolean)
    .join(' · ');
  const aimValue = card.aim
    ? card.aim.fromTitle
      ? t('setup.aim.fromTitle')
      : [card.aim.focus, t('setup.aim.objectives', { n: card.aim.objectives })]
          .filter(Boolean)
          .join(' · ')
    : '';
  const chaptersValue =
    card.chapters === 'standard'
      ? t('setup.chapters.foldedStandard')
      : card.chapters === 'none'
        ? t('setup.chapters.foldedNone')
        : t('setup.chapters.folded', { n: doc.chapters.length });
  const index = (step: SetupStep) => setupStepNumber(step);
  const state = (step: SetupStep): 'done' | 'open' | 'pending' =>
    step === open ? 'open' : card.done || index(step) < index(card.step) ? 'done' : 'pending';
  const edit = (row: 'title' | 'field', words: string, testId: string) => (
    <LinkButton
      onClick={() => setReopened(row)}
      disabled={busy || reopened !== null}
      testId={testId}
    >
      {words}
    </LinkButton>
  );

  const planFrom = card.aim?.fromTitle === false ? 'answers' : 'title';
  /** Long steps scroll inside the card on a short screen, so the first heading stays in view. */
  const body =
    'min-w-0 [@media(max-height:820px)]:max-h-[40vh] [@media(max-height:820px)]:overflow-y-auto [@media(max-height:820px)]:pr-1';

  return (
    <section
      data-testid="setup-card"
      data-step={card.step}
      data-done={card.done ? 'true' : 'false'}
      aria-label={t('setup.title')}
      className={cn(
        'mx-auto max-w-[72ch] overflow-hidden rounded-lg border border-line bg-surface',
        placement === 'top' ? 'mb-3' : 'mb-4',
      )}
    >
      <header className="flex min-w-0 items-baseline justify-between gap-3 px-4 pt-3 pb-2">
        <h2 className="min-w-0 truncate text-[14.5px] font-semibold text-ink">
          {card.done ? t('setup.titleDone') : t('setup.title')}{' '}
          {card.done ? null : (
            <span className="ml-1 font-normal text-muted" data-testid="setup-count">
              {t('setup.count', { n: index(card.step) })}
            </span>
          )}
        </h2>
        {card.done ? null : placement === 'top' ? (
          <button
            type="button"
            data-testid="setup-finish-later"
            disabled={busy}
            onClick={() => void save({ dismissed: true })}
            className="shrink-0 text-[12.5px] text-muted underline underline-offset-2 hover:text-ink"
          >
            {t('setup.finishLater')}
          </button>
        ) : (
          <button
            type="button"
            data-testid="setup-continue"
            disabled={busy}
            onClick={() => void save({ dismissed: false })}
            className="shrink-0 text-[12.5px] font-semibold text-accent hover:underline"
          >
            {t('setup.continue')}
          </button>
        )}
      </header>

      <div className="pb-1">
        {/* Row 1: title, then the Sources line as its own row once folded. */}
        {state('title') === 'open' ? (
          <Row id="title" state="open" label={t('setup.row.title')}>
            <form onSubmit={(e) => void confirmTitle(e)} className="min-w-0">
              <div className={body}>
                <label htmlFor="setup-title" className="text-[14px] font-semibold text-ink">
                  {t('setup.title.question')}
                </label>
                <input
                  id="setup-title"
                  // biome-ignore lint/a11y/noAutofocus: the one thing to do on a new thesis.
                  autoFocus
                  value={title}
                  maxLength={300}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t('setup.title.placeholder')}
                  data-testid="setup-title-input"
                  className="mt-1.5 h-10 w-full min-w-0 rounded-md border border-line-strong bg-surface px-3 text-[14px] text-ink focus:border-accent focus:outline-none"
                />
                <p className="mt-1 text-[12.5px] text-muted">
                  {title.trim() && !titleReady ? t('setup.title.short') : t('setup.title.hint')}
                </p>
                <div className="mt-3">
                  <StartingStyle value={style} onChange={setStyle} compact />
                </div>
                <p className="mt-2 text-[12.5px] text-muted [overflow-wrap:anywhere]">
                  {t('setup.sources.label')} {sourcesLine(prefs, null, t)}{' '}
                  <LinkButton onClick={() => setPrefsOpen((v) => !v)} testId="setup-sources-change">
                    {prefsOpen ? t('setup.sources.done') : t('setup.change')}
                  </LinkButton>
                </p>
                {prefsOpen ? (
                  <div className="mt-1 rounded-md border border-line bg-surface px-3 pb-2">
                    <SourcePrefsFields
                      value={prefs}
                      onChange={setPrefs}
                      onValidChange={setPrefsValid}
                      testIdPrefix="setup"
                    />
                  </div>
                ) : null}
                {reopened ? null : (
                  <p className="mt-2 text-[12.5px] text-muted">
                    {t('setup.or')}{' '}
                    <Link
                      href="/app/new?start=paper"
                      className="underline underline-offset-2 hover:text-ink"
                      data-testid="setup-link-paper"
                    >
                      {t('setup.link.paper')}
                    </Link>
                    {' · '}
                    <LinkButton
                      onClick={() => window.dispatchEvent(new Event(OPEN_WORD_IMPORT))}
                      testId="setup-link-word"
                    >
                      {t('setup.link.word')}
                    </LinkButton>
                    {' · '}
                    <LinkButton onClick={() => void toProposal()} testId="setup-link-proposal">
                      {t('setup.link.proposal')}
                    </LinkButton>
                  </p>
                )}
              </div>
              <div className="mt-3 flex justify-end gap-2">
                {reopened ? (
                  <Button type="button" variant="secondary" onClick={() => setReopened(null)}>
                    {t('common.cancel')}
                  </Button>
                ) : null}
                <Button
                  type="submit"
                  disabled={busy || !titleReady || !prefsValid}
                  data-testid="setup-title-next"
                >
                  {busy ? t('setup.saving') : reopened ? t('setup.save') : t('setup.next')}
                </Button>
              </div>
            </form>
          </Row>
        ) : (
          <>
            <Row
              id="title"
              state={state('title')}
              label={t('setup.row.title')}
              value={doc.title}
              action={edit('title', t('common.edit'), 'setup-edit-title')}
            />
            <Row
              id="sources"
              state={state('title')}
              label={t('setup.row.sources')}
              value={sources}
              action={edit('title', t('setup.change'), 'setup-change-sources')}
            />
          </>
        )}

        {/* Row 2: field and university. */}
        {index(card.step) >= 2 || card.done ? (
          state('field') === 'open' ? (
            <Row id="field" state="open" label={t('setup.row.field')}>
              <div className="min-w-0">
                <div className={body}>
                  <p className="text-[14px] font-semibold text-ink">{t('setup.field.question')}</p>
                  <p className="mt-0.5 text-[12.5px] text-muted">{t('setup.field.hint')}</p>
                  <label
                    htmlFor="setup-field"
                    className="mt-2.5 block text-[13px] font-semibold text-ink"
                  >
                    {t('setup.field.label')}
                  </label>
                  <select
                    id="setup-field"
                    value={field}
                    onChange={(e) => setField(e.target.value)}
                    data-testid="setup-field"
                    className="mt-1 h-9 w-full min-w-0 rounded-md border border-line-strong bg-surface px-2 text-[13.5px] text-ink"
                  >
                    <option value="">{t('setup.field.none')}</option>
                    {DISCIPLINE_PROFILES.map((d) => (
                      <option key={d.id} value={d.displayName}>
                        {d.displayName}
                      </option>
                    ))}
                    {field && !DISCIPLINE_PROFILES.some((d) => d.displayName === field) ? (
                      <option value={field}>{field}</option>
                    ) : null}
                  </select>
                  {guessed && field === guessed.displayName && !doc.field ? (
                    <p className="mt-1 text-[12px] text-muted">{t('setup.field.guessed')}</p>
                  ) : null}
                  <label
                    htmlFor="setup-university"
                    className="mt-2.5 block text-[13px] font-semibold text-ink"
                  >
                    {t('setup.university.label')}
                  </label>
                  <select
                    id="setup-university"
                    value={universityId}
                    onChange={(e) => setUniversityId(e.target.value)}
                    data-testid="setup-university"
                    className="mt-1 h-9 w-full min-w-0 rounded-md border border-line-strong bg-surface px-2 text-[13.5px] text-ink"
                  >
                    <option value="">{t('setup.field.none')}</option>
                    {UNIVERSITY_PROFILES.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.displayName}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => (reopened ? setReopened(null) : void confirmField(true))}
                    data-testid="setup-field-skip"
                  >
                    {reopened ? t('common.cancel') : t('setup.skip')}
                  </Button>
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() => void confirmField(false)}
                    data-testid="setup-field-next"
                  >
                    {busy ? t('setup.saving') : reopened ? t('setup.save') : t('setup.next')}
                  </Button>
                </div>
              </div>
            </Row>
          ) : (
            <Row
              id="field"
              state={state('field')}
              label={t('setup.row.field')}
              value={fieldValue}
              action={edit('field', t('setup.change'), 'setup-change-field')}
            />
          )
        ) : null}

        {/* Row 3: the start questions. */}
        {index(card.step) >= 3 || card.done ? (
          state('aim') === 'open' ? (
            <Row id="aim" state="open" label={t('setup.row.aim')}>
              <div className="min-w-0">
                <SetupAim
                  documentId={doc.id}
                  title={doc.title}
                  onPlanned={planned}
                  onNoPlan={noPlan}
                />
              </div>
            </Row>
          ) : (
            <Row
              id="aim"
              state={state('aim')}
              label={t('setup.row.aim')}
              value={aimValue}
              action={
                <Link
                  href={`/app/d/${doc.id}/proposal`}
                  className="text-muted underline underline-offset-2 hover:text-ink"
                  data-testid="setup-edit-aim"
                >
                  {t('common.edit')}
                </Link>
              }
            />
          )
        ) : null}

        {/* Row 4: the chapters, filling in place. */}
        {index(card.step) >= 4 || card.done ? (
          state('chapters') === 'open' ? (
            <Row id="chapters" state="open" label={t('setup.row.chapters')}>
              <div className="min-w-0" data-plan={plan ?? 'unknown'}>
                {plan === 'planning' ? (
                  <div role="status" aria-busy="true" data-testid="setup-planning">
                    <p className="text-[14px] font-semibold text-ink">
                      {planFrom === 'answers'
                        ? t('setup.chapters.planningAnswers')
                        : t('setup.chapters.planningTitle')}
                    </p>
                    <p className="mt-0.5 text-[12.5px] text-muted">
                      {t('setup.chapters.planningDetail')}
                    </p>
                    <div className="mt-2 grid gap-1.5" aria-hidden="true">
                      <div className="h-2.5 w-2/5 animate-pulse rounded bg-sunk motion-reduce:animate-none" />
                      <div className="h-2.5 w-3/5 animate-pulse rounded bg-sunk motion-reduce:animate-none" />
                    </div>
                  </div>
                ) : plan === 'notPlanned' ? (
                  <p className="text-[13.5px] text-ink" data-testid="setup-plan-failed">
                    {t('setup.chapters.failed')}
                  </p>
                ) : (
                  <p className="text-[13.5px] text-ink" data-testid="setup-planned">
                    <span className="font-semibold">{t('setup.row.chapters')}</span>{' '}
                    {planFrom === 'answers'
                      ? t('setup.chapters.plannedAnswers', { n: doc.chapters.length })
                      : t('setup.chapters.plannedTitle', { n: doc.chapters.length })}
                  </p>
                )}
                {plan === 'planning' ? null : (
                  <>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {plan === 'notPlanned' ? (
                        <Button
                          type="button"
                          disabled={busy}
                          onClick={() => void retryPlan()}
                          data-testid="setup-plan-retry"
                        >
                          {t('setup.chapters.retry')}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          disabled={busy}
                          onClick={() => void keep()}
                          data-testid="setup-keep"
                        >
                          {t('setup.chapters.keep')}
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => void restart('standard')}
                        data-testid="setup-standard"
                      >
                        {t('setup.chapters.standard')}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => void restart('none')}
                        data-testid="setup-none"
                      >
                        {t('setup.chapters.none')}
                      </Button>
                    </div>
                    <Link
                      href={`/app/d/${doc.id}/outline`}
                      className="mt-2 inline-block text-[12.5px] text-muted underline underline-offset-2 hover:text-ink"
                      data-testid="setup-edit-outline"
                    >
                      {t('setup.chapters.edit')}
                    </Link>
                  </>
                )}
              </div>
            </Row>
          ) : (
            <Row
              id="chapters"
              state={state('chapters')}
              label={t('setup.row.chapters')}
              value={chaptersValue}
              action={
                <Link
                  href={`/app/d/${doc.id}/outline`}
                  className="text-muted underline underline-offset-2 hover:text-ink"
                >
                  {t('setup.chapters.edit')}
                </Link>
              }
            />
          )
        ) : null}

        {/* Row 5: the first line, shown (waiting) from row 4 on. */}
        {index(card.step) >= 4 || card.done ? (
          state('first') === 'open' ? (
            <Row id="first" state="open" label={t('setup.row.first')}>
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-ink">{t('setup.first.waiting')}</p>
                  <p className="mt-0.5 text-[12.5px] text-muted">{t('setup.first.hint')}</p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => offerFirstLine()}
                  data-testid="setup-suggest"
                >
                  {t('setup.first.suggest')}
                </Button>
              </div>
            </Row>
          ) : (
            <Row
              id="first"
              state={state('first')}
              label={t('setup.row.first')}
              value={card.done ? t('setup.first.written') : t('setup.first.waiting')}
            />
          )
        ) : null}
      </div>

      {error || limit.value ? (
        <div className="px-4 pb-3">
          <LimitNotice limit={limit.value} />
          {error ? (
            <p role="alert" className="text-[12.5px] text-warn">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
