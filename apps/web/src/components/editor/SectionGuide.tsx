'use client';

/**
 * The Sections panel (ADR-0072, from the side-by-side study's item B1).
 *
 * Jenni turns a new document's topic into headings within seconds and shows, for each, two or
 * three lines of what it should argue and a Generate button. Ours opened one empty "Chapter 1".
 * This panel sits above the page and shows the open chapter's plan:
 *
 * - while the chapters are being planned, "Planning your chapters from your title…";
 * - with no plan and a title to plan from, "Plan my chapters from the title";
 * - with a plan, what the chapter is for and each of its sections: what the section should argue,
 *   "Add heading here" (the section's title as a heading at the cursor) and "Draft this section"
 *   (the heading, the cursor under it, then Draft mode, which drafts the section under the
 *   cursor — ADR-0071).
 *
 * It replaces the scaffold panel (FR-4.2), which showed the same scope notes with nothing to press.
 * Nothing here enters the chapter unless the student presses a button, and a draft still arrives
 * as a pending draft block the student must accept.
 */

import { getGhostState } from '@tc/ui';
import type { Editor } from '@tiptap/core';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useT } from '@/i18n/react';
import { ApiError, api } from '@/lib/api';
import { findSectionHeading, headingSlot, scopeBullets, sectionEnd } from '@/lib/section-guide';
import { dismissHint, isHintDismissed } from '../onboarding/FirstRunHint';
import { DRAFT_SECTION_EVENT } from './DraftMode';

type Node = {
  id: string;
  title: string;
  scopeNote: string;
  mappedFromPaperSection?: string;
  children: Node[];
};

type OutlineView = {
  outline: Node[];
  chapters: Array<{ id: string; outlineNodeId: string; title: string }>;
  generating: boolean;
  generatingFrom?: 'title' | 'proposal' | null;
  outlineFailed?: boolean;
  canPlanFromTitle?: boolean;
};

/** How often to look again while the chapters are being planned. */
const POLL_MS = 4_000;

/** The placeholder heading a new chapter opens with ("Chapter 1"); ours, not the student's. */
const PLACEHOLDER_HEADING = /^chapter\s+\d+$/i;

function findNode(nodes: Node[], id: string): Node | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNode(node.children, id);
    if (found) return found;
  }
  return null;
}

/** "Add heading here": the title as a level-2 heading after the cursor's block, cursor below it. */
function addHeading(editor: Editor, title: string): void {
  const { doc, selection } = editor.state;
  const slot = headingSlot(doc, selection.from);
  editor
    .chain()
    .focus()
    .insertContentAt(slot, [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: title }] },
      { type: 'paragraph' },
    ])
    .run();
  const at = findSectionHeading(editor.state.doc, title);
  if (at !== null) {
    const heading = editor.state.doc.nodeAt(at);
    // Inside the empty paragraph just below the heading.
    editor
      .chain()
      .setTextSelection(at + (heading?.nodeSize ?? 0) + 1)
      .scrollIntoView()
      .run();
  }
}

/** Puts the cursor at the end of the section under `title`, adding the heading if it is missing. */
function placeCursorInSection(editor: Editor, title: string): void {
  const at = findSectionHeading(editor.state.doc, title);
  if (at === null) {
    addHeading(editor, title);
    return;
  }
  const end = sectionEnd(editor.state.doc, at);
  // `end` is the boundary after the section's last block; one back is inside that block.
  editor
    .chain()
    .focus()
    .setTextSelection(Math.max(at + 1, end - 1))
    .scrollIntoView()
    .run();
}

export function SectionGuide({
  documentId,
  chapterId,
  editor,
}: {
  documentId: string;
  chapterId: string;
  editor: Editor | null;
}) {
  const { t } = useT();
  const [view, setView] = useState<OutlineView | null>(null);
  const [open, setOpen] = useState(true);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Bumped after "Plan my chapters", which restarts the polling loop below. */
  const [polls, setPolls] = useState(0);
  /** Bumped on every edit, so "in your chapter" follows the headings as they are typed. */
  const [, setRevision] = useState(0);

  const load = useCallback(
    () =>
      api<OutlineView>(`/documents/${documentId}/outline`)
        .then((next) => {
          setView(next);
          return next;
        })
        .catch(() => null),
    [documentId],
  );

  // Look again every few seconds while the plan is being made; stop when it lands.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `polls` restarts the loop after the student asks for a plan.
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const next = await load();
      if (live && next?.generating) timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [load, polls]);

  useEffect(() => {
    if (!editor) return;
    const bump = () => setRevision((n) => n + 1);
    editor.on('update', bump);
    return () => {
      editor.off('update', bump);
    };
  }, [editor]);

  const row = view?.chapters.find((c) => c.id === chapterId) ?? null;
  const node = row && view ? findNode(view.outline, row.outlineNodeId) : null;

  useEffect(() => {
    if (!node) return;
    // Folded on a phone, as the scaffold was: open, it filled most of a 375 px screen.
    const wide = window.matchMedia('(min-width: 640px)').matches;
    setOpen(wide && !isHintDismissed(`sections-${node.id}`));
  }, [node?.id, node]);

  // The chapter opened as "Chapter 1" and the plan has since named it. The heading at the top is
  // our placeholder, not the student's words, so it takes the planned title. Anything else the
  // student has typed there is left as it is.
  useEffect(() => {
    if (!editor || !row || PLACEHOLDER_HEADING.test(row.title.trim())) return;
    const rename = (): boolean => {
      const first = editor.state.doc.firstChild;
      if (first?.type.name !== 'heading' || Number(first.attrs.level ?? 1) !== 1) return true;
      if (!PLACEHOLDER_HEADING.test(first.textContent.trim())) return true;
      // Any edit dismisses a suggestion on screen, so the rename waits until none is (seen in
      // the real-model run, 2026-10-05: the plan landed and wiped the student's first suggestion).
      if ((getGhostState(editor)?.status ?? 'idle') !== 'idle') return false;
      editor
        .chain()
        .command(({ tr }) => {
          tr.insertText(row.title, 1, 1 + first.content.size);
          return true;
        })
        .run();
      return true;
    };
    if (rename()) return;
    const retry = () => {
      if (rename()) editor.off('transaction', retry);
    };
    editor.on('transaction', retry);
    return () => {
      editor.off('transaction', retry);
    };
  }, [editor, row]);

  async function planFromTitle() {
    setAsking(true);
    setError(null);
    try {
      await api(`/documents/${documentId}/outline/plan-from-title`, {
        method: 'POST',
        body: '{}',
      });
      setView((current) =>
        current
          ? { ...current, generating: true, generatingFrom: 'title', outlineFailed: false }
          : current,
      );
      setPolls((n) => n + 1);
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : t('sections.failed'),
      );
    } finally {
      setAsking(false);
    }
  }

  if (!view) return null;

  const box = 'mx-auto mb-4 max-w-[72ch] rounded-md border border-line bg-paper px-4 py-3 text-sm';

  if (view.generating) {
    return (
      <section className={box} data-testid="section-guide" aria-busy="true">
        <p role="status" className="font-medium" data-testid="section-guide-planning">
          {view.generatingFrom === 'proposal'
            ? t('sections.planningProposal')
            : t('sections.planning')}
        </p>
        <p className="mt-1 text-xs text-muted">{t('sections.planningDetail')}</p>
        {/* The shape of what is coming, so the page does not jump when it lands. */}
        <div className="mt-3 grid gap-2" aria-hidden="true">
          <div className="h-3 w-2/5 animate-pulse rounded bg-sunk" />
          <div className="h-3 w-4/5 animate-pulse rounded bg-sunk" />
          <div className="h-3 w-3/5 animate-pulse rounded bg-sunk" />
        </div>
      </section>
    );
  }

  if (!node) {
    if (!view.canPlanFromTitle) return null;
    return (
      <section className={box} data-testid="section-guide">
        <p className="font-medium">
          {view.outlineFailed ? t('sections.failed') : t('sections.noPlan')}
        </p>
        <p className="mt-1 text-xs text-muted">{t('sections.noPlanDetail')}</p>
        <button
          type="button"
          onClick={() => void planFromTitle()}
          disabled={asking}
          className="mt-2 rounded-md border border-ink px-3 py-1 text-xs font-semibold hover:bg-surface disabled:opacity-60"
          data-testid="plan-from-title"
        >
          {view.outlineFailed ? t('sections.retry') : t('sections.plan')}
        </button>
        {error ? (
          <p role="alert" className="mt-2 text-xs text-warn">
            {error}
          </p>
        ) : null}
      </section>
    );
  }

  const doc = editor?.state.doc ?? null;

  return (
    <section className={box} data-testid="section-guide">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-xs uppercase tracking-wide text-muted">{t('sections.chapterFor')}</h2>
        <button
          type="button"
          className="text-xs text-muted underline"
          aria-expanded={open}
          onClick={() => {
            const next = !open;
            setOpen(next);
            if (!next) dismissHint(`sections-${node.id}`);
          }}
        >
          {open ? t('sections.hide') : t('sections.show')}
        </button>
      </div>
      {open ? (
        <>
          {node.scopeNote ? <p className="mt-2">{node.scopeNote}</p> : null}
          {node.children.length > 0 ? (
            <>
              <h3 className="mt-3 text-xs uppercase tracking-wide text-muted">
                {t('sections.title')}
              </h3>
              <ol className="mt-1 grid list-none gap-3 p-0" data-testid="section-guide-sections">
                {node.children.map((child) => {
                  const present = doc ? findSectionHeading(doc, child.title) !== null : false;
                  return (
                    <li key={child.id} data-testid="section-guide-item">
                      <p className="flex items-baseline gap-2 font-medium">
                        <span>{child.title}</span>
                        {present ? (
                          <span className="text-[11px] font-normal text-muted">
                            {t('sections.inChapter')}
                          </span>
                        ) : null}
                      </p>
                      <ul className="mt-0.5 list-disc pl-5 text-xs text-muted">
                        {scopeBullets(child.scopeNote).map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                      <div className="mt-1 flex flex-wrap gap-3 text-xs">
                        <button
                          type="button"
                          className="underline disabled:opacity-60"
                          disabled={!editor}
                          // Keep the cursor where the student left it.
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            if (!editor) return;
                            if (present) placeCursorInSection(editor, child.title);
                            else addHeading(editor, child.title);
                          }}
                        >
                          {present ? t('sections.goTo') : t('sections.addHeading')}
                        </button>
                        <button
                          type="button"
                          className="font-semibold underline disabled:opacity-60"
                          disabled={!editor}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            if (!editor) return;
                            placeCursorInSection(editor, child.title);
                            editor.view.dom.dispatchEvent(new CustomEvent(DRAFT_SECTION_EVENT));
                          }}
                        >
                          {t('sections.draft')}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </>
          ) : null}
          <p className="mt-3 text-xs text-muted">
            {t('sections.note')}{' '}
            <Link href={`/app/d/${documentId}/outline`} className="underline">
              {t('sections.editOutline')}
            </Link>
          </p>
        </>
      ) : null}
    </section>
  );
}
