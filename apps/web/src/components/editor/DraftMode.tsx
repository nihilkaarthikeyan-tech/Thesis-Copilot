'use client';

/**
 * Draft mode in the editor — PRD FR-4.4, §9.3, PHASES 4.2.
 *
 *   "Student selects an outline section … → 'Draft this section' → … Result is inserted **as a
 *   clearly marked draft block** … that the student must 'Accept draft' or 'Discard' before it
 *   becomes normal content."
 *
 * The draft never becomes ordinary text on its own. It arrives inside a `draftBlock` carrying
 * `DRAFT` provenance, and only the student's explicit Accept unwraps it. That is the "flag, don't
 * fix" rule from the PRD's hard constraints, applied to the largest thing the AI writes.
 */

import { headingKey, type OutlineNode, walkOutline } from '@tc/types';
import { findDraft, sectionUnderCursor } from '@tc/ui';
import type { Editor } from '@tiptap/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n/react';
import { API_URL, ApiError, api, type ProblemDetails } from '@/lib/api';
import { type LimitRefusal, limitRefusal } from '@/lib/limit';
import { parseSse } from '@/lib/sse';
import { LimitNotice } from '../LimitNotice';

/**
 * Asks for a draft of the section under the cursor, as Ctrl+Shift+D does. The key bar's button
 * dispatches it on `window` (ADR-0073); the Sections panel places the cursor under a section's
 * heading and dispatches it on the editor's DOM (ADR-0072). Draft mode listens on both.
 */
export const DRAFT_SECTION_EVENT = 'tc:draft-section';

/**
 * ADR-0155 (the Word test, 2026-10-16): "Draft a section" started at once, without saying what it
 * would draft; Jenni shows an editable note per section first. The key bar's button and
 * Ctrl+Shift+D now open a small confirm: the section's name, its note (what it should cover,
 * editable, saved as the section's note), and Draft. One extra click; Ctrl+Enter, or Ctrl+Shift+D
 * again, drafts from it. A trigger that has just shown the note (the Sections panel, the section
 * guide) sends `{ detail: { confirmed: true } }` and drafts at once, as before.
 */
export type DraftSectionDetail = { confirmed?: boolean };

type OutlineView = {
  outline: OutlineNode[];
  chapters: Array<{ id: string; outlineNodeId: string }>;
};

/**
 * The note the confirm shows: the planned section's under a heading, else the chapter's. It can
 * be changed only under a heading of a chapter that is in the plan, which is where the section's
 * note is kept (`PUT /documents/:id/outline/section-note`).
 */
export function noteFor(
  view: OutlineView | null,
  chapterId: string,
  heading: string | null,
): { note: string; editable: boolean } {
  const row = view?.chapters.find((c) => c.id === chapterId);
  const chapterNode = row ? view?.outline.find((n) => n.id === row.outlineNodeId) : undefined;
  if (!heading) return { note: chapterNode?.scopeNote ?? '', editable: false };
  const key = headingKey(heading);
  const section = walkOutline(chapterNode?.children ?? []).find((n) => headingKey(n.title) === key);
  return { note: section?.scopeNote ?? '', editable: chapterNode !== undefined };
}

type DraftCitation = { key: string; sourceId: string; chunkId?: string; rendered?: string };

type DraftResult = {
  markdown: string;
  citations: DraftCitation[];
  needsSource: string[];
  words: number;
};

type State =
  | { phase: 'idle' }
  /** ADR-0155: what will be drafted, before anything is spent. */
  | {
      phase: 'confirm';
      heading: string | null;
      note: string;
      original: string;
      /** The note can be changed: a heading in a chapter that is in the plan. */
      editable: boolean;
      loading: boolean;
      saving: boolean;
      error: string | null;
    }
  | { phase: 'working'; stage: string }
  | { phase: 'refused'; reason: string; title?: string }
  | { phase: 'error'; message: string }
  /** R31 (ADR-0122): refused by an allowance, the trial or a budget. */
  | { phase: 'limit'; limit: LimitRefusal }
  | {
      phase: 'done';
      words: number;
      targetWords: number;
      short: boolean;
      needsSource: string[];
      closeTo: CloseTo[];
    };

/** ADR-0071: a draft paragraph that follows a passage's wording too closely. */
type CloseTo = { shortRef: string; page: number | null; overlapText: string; kind: string };

export function DraftMode({
  editor,
  documentId,
  chapterId,
  chapterTitle,
  outlineNodeId,
  onUsageChange,
}: {
  editor: Editor | null;
  documentId: string;
  chapterId: string;
  chapterTitle: string;
  outlineNodeId: string;
  onUsageChange: () => void;
}) {
  const { t } = useT();
  const [state, setState] = useState<State>({ phase: 'idle' });
  const stateRef = useRef(state);
  stateRef.current = state;
  const noteRef = useRef<HTMLTextAreaElement>(null);
  /** The draft this panel is about, so the panel can close itself once it is resolved. */
  const [draftId, setDraftId] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (!editor || state.phase === 'working') return;
    setState({ phase: 'working', stage: 'retrieving' });

    try {
      const response = await fetch(`${API_URL}/api/v1/draft/section`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        // ADR-0071: the section the cursor is in, so the draft is about it rather than the
        // chapter as a whole.
        body: JSON.stringify({
          chapterId,
          outlineNodeId,
          ...sectionUnderCursor(editor.state.doc, editor.state.selection.from),
        }),
      });

      if (!response.ok) {
        const problem = (await response.json().catch(() => null)) as ProblemDetails | null;
        throw new ApiError(
          problem ?? { type: 'HTTP_ERROR', title: response.statusText, status: response.status },
        );
      }

      let draftId = '';
      for await (const { event, data } of parseSse(response)) {
        const parsed = data ? (JSON.parse(data) as Record<string, unknown>) : {};

        if (event === 'start') {
          draftId = String(parsed.draftId);
          continue;
        }
        if (event === 'progress') {
          setState({ phase: 'working', stage: String(parsed.stage ?? 'writing') });
          continue;
        }
        if (event === 'refused') {
          // FR-4.4's AC: a draft with no sources refuses and explains.
          setState({ phase: 'refused', reason: String(parsed.reason ?? '') });
          return;
        }
        if (event === 'error') {
          setState({ phase: 'error', message: String(parsed.message ?? 'The draft failed.') });
          return;
        }
        if (event === 'done') {
          const result = parsed.result as DraftResult;
          insertDraft(editor, draftId, result, (parsed.content ?? []) as unknown[]);
          setDraftId(draftId);
          onUsageChange();
          setState({
            phase: 'done',
            words: Number(parsed.words ?? result.words),
            targetWords: Number(parsed.targetWords ?? 0),
            short: Boolean(parsed.short),
            needsSource: result.needsSource ?? [],
            closeTo: Array.isArray(parsed.closeTo) ? (parsed.closeTo as CloseTo[]) : [],
          });
          return;
        }
      }
    } catch (error) {
      const limit = limitRefusal(error);
      if (limit) {
        setState({ phase: 'limit', limit });
        return;
      }
      // ADR-0071: no topic for this section. Said as a refusal with its fix, not as a failure.
      if (error instanceof ApiError && error.problem.type === 'SECTION_NEEDS_TOPIC') {
        setState({
          phase: 'refused',
          title: error.problem.title,
          reason: error.problem.detail ?? '',
        });
        return;
      }
      setState({
        phase: 'error',
        message:
          error instanceof ApiError
            ? (error.problem.detail ?? error.problem.title)
            : 'The draft could not be started.',
      });
    }
  }, [editor, chapterId, outlineNodeId, onUsageChange, state.phase]);

  /** ADR-0155: the confirm, with the section's name and its note, before anything is spent. */
  const ask = useCallback(() => {
    if (!editor || stateRef.current.phase === 'working') return;
    const { heading } = sectionUnderCursor(editor.state.doc, editor.state.selection.from);
    const under = heading?.trim() || null;
    setState({
      phase: 'confirm',
      heading: under,
      note: '',
      original: '',
      editable: false,
      loading: true,
      saving: false,
      error: null,
    });
    void api<OutlineView>(`/documents/${documentId}/outline`)
      .catch(() => null)
      .then((view) => {
        const { note, editable } = noteFor(view, chapterId, under);
        setState((current) =>
          current.phase === 'confirm' && current.loading
            ? { ...current, note, original: note, editable, loading: false }
            : current,
        );
      });
  }, [editor, documentId, chapterId]);

  /** Draft, from the confirm: the note saved first when the student changed it. */
  const confirm = useCallback(async () => {
    const current = stateRef.current;
    if (current.phase !== 'confirm' || current.saving || current.loading) return;
    if (current.editable && current.heading && current.note.trim() !== current.original.trim()) {
      setState({ ...current, saving: true, error: null });
      try {
        await api(`/documents/${documentId}/outline/section-note`, {
          method: 'PUT',
          body: JSON.stringify({ chapterId, title: current.heading, scopeNote: current.note }),
        });
      } catch (e) {
        setState({
          ...current,
          saving: false,
          error:
            e instanceof ApiError
              ? (e.problem.detail ?? e.problem.title)
              : t('draft.confirm.saveError'),
        });
        return;
      }
    }
    setState({ phase: 'idle' });
    await run();
  }, [documentId, chapterId, run, t]);

  // The note box takes the keyboard once the note is in.
  const loaded = state.phase === 'confirm' && !state.loading;
  useEffect(() => {
    if (loaded) noteRef.current?.focus();
  }, [loaded]);

  // ADR-0071: once the student accepts or discards the draft, this panel has nothing left to say
  // (it stayed up saying "Draft inserted" after a discard).
  useEffect(() => {
    if (!editor || !draftId || state.phase !== 'done') return;
    const check = () => {
      const found = findDraft(editor.state.doc, draftId);
      if (!found || found.node.attrs.status !== 'pending') {
        setState({ phase: 'idle' });
        setDraftId(null);
      }
    };
    editor.on('update', check);
    return () => {
      editor.off('update', check);
    };
  }, [editor, draftId, state.phase]);

  // §2.2's shortcut. Registered on the editor's own DOM so it does not fire while the student is
  // typing in a panel input.
  useEffect(() => {
    if (!editor) return;
    // ADR-0155: the shortcut opens the confirm; pressed again there, it drafts.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'd' || !event.ctrlKey || !event.shiftKey) return;
      event.preventDefault();
      if (stateRef.current.phase === 'confirm') void confirm();
      else ask();
    };
    const fromEvent = (event: Event) => {
      if ((event as CustomEvent<DraftSectionDetail | null>).detail?.confirmed) void run();
      else ask();
    };
    const onDraftSection = fromEvent;
    const dom = editor.view.dom;
    const onAsk = fromEvent;
    dom.addEventListener('keydown', onKeyDown);
    // ADR-0073 / ADR-0072: asked for from a window event (the key bar) or the editor's own DOM
    // (the section guide).
    window.addEventListener(DRAFT_SECTION_EVENT, onAsk);
    dom.addEventListener(DRAFT_SECTION_EVENT, onDraftSection);
    return () => {
      dom.removeEventListener('keydown', onKeyDown);
      window.removeEventListener(DRAFT_SECTION_EVENT, onAsk);
      dom.removeEventListener(DRAFT_SECTION_EVENT, onDraftSection);
    };
  }, [editor, run, ask, confirm]);

  if (state.phase === 'idle') return null;

  if (state.phase === 'confirm') {
    const title = state.heading ?? chapterTitle;
    return (
      <aside
        data-testid="draft-confirm"
        aria-label={t('draft.confirm.title')}
        className="fixed bottom-20 left-1/2 z-30 w-[30rem] max-w-[92vw] -translate-x-1/2 overflow-hidden rounded-lg border border-line bg-surface text-sm shadow-lg"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void confirm();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setState({ phase: 'idle' });
            const ctrl = event.ctrlKey || event.metaKey;
            if (
              (event.key === 'Enter' && ctrl) ||
              (event.key.toLowerCase() === 'd' && event.ctrlKey && event.shiftKey)
            ) {
              event.preventDefault();
              void confirm();
            }
          }}
          className="p-4"
        >
          <p className="text-[14px] font-semibold text-ink">{t('draft.confirm.title')}</p>
          <p
            className="mt-0.5 text-[13px] text-muted [overflow-wrap:anywhere]"
            data-testid="draft-confirm-section"
          >
            {title}
          </p>
          <label
            htmlFor="draft-confirm-note"
            className="mt-3 block text-[12.5px] font-semibold text-ink"
          >
            {t('draft.confirm.noteLabel')}
          </label>
          <textarea
            id="draft-confirm-note"
            ref={noteRef}
            data-testid="draft-confirm-note"
            rows={3}
            maxLength={1_000}
            value={state.loading ? '' : state.note}
            readOnly={!state.editable}
            disabled={state.loading || state.saving}
            placeholder={
              state.loading ? t('draft.confirm.loading') : t('draft.confirm.notePlaceholder')
            }
            onChange={(e) => {
              const note = e.target.value;
              setState((current) => (current.phase === 'confirm' ? { ...current, note } : current));
            }}
            className="mt-1 w-full min-w-0 resize-y rounded-md border border-line-strong bg-surface px-3 py-2 text-[13px] text-ink focus:border-accent focus:outline-none disabled:opacity-70"
          />
          <p className="mt-1 text-[12px] text-muted">
            {state.heading
              ? state.editable
                ? t('draft.confirm.hint')
                : t('draft.confirm.unplannedHint')
              : t('draft.confirm.chapterHint')}
          </p>
          {state.error ? (
            <p role="alert" className="mt-1 text-[12.5px] text-warn">
              {state.error}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setState({ phase: 'idle' })}
              data-testid="draft-confirm-cancel"
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={state.loading || state.saving}
              data-testid="draft-confirm-go"
            >
              {t('draft.confirm.draft')}
            </Button>
          </div>
        </form>
      </aside>
    );
  }

  return (
    <aside
      data-testid="draft-status"
      className="fixed bottom-20 left-1/2 z-30 w-[30rem] max-w-[92vw] -translate-x-1/2 rounded-md border border-line bg-surface p-3 text-sm shadow-lg"
    >
      {state.phase === 'working' ? (
        <p className="text-muted">
          {state.stage === 'retrieving'
            ? 'Finding the sources for this section…'
            : state.stage === 'searching'
              ? // ADR-0076: a thin section looks for more papers before it is written.
                'Your library is thin on this section — finding more papers first…'
              : 'Writing the draft…'}
        </p>
      ) : null}

      {state.phase === 'refused' ? (
        <>
          <p className="font-medium">{state.title ?? 'This section has nothing to draft from.'}</p>
          <p className="mt-1 text-muted">{state.reason}</p>
        </>
      ) : null}

      {state.phase === 'error' ? <p className="text-warn">{state.message}</p> : null}

      {state.phase === 'limit' ? <LimitNotice limit={state.limit} /> : null}

      {state.phase === 'done' ? (
        <>
          <p className="font-medium">
            Draft inserted: {state.words} words
            {state.targetWords > 0 ? ` of about ${state.targetWords}` : ''}.
          </p>
          {state.short ? (
            <p className="mt-1 text-warn">
              The pinned sources did not cover enough of this section.
            </p>
          ) : null}
          {state.needsSource.length > 0 ? (
            <div className="mt-2">
              <p className="text-xs text-muted">Still needs a source for:</p>
              <ul className="mt-1 list-disc pl-4 text-xs">
                {state.needsSource.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {state.closeTo.length > 0 ? (
            <div className="mt-2" data-testid="draft-close-to">
              <p className="text-xs text-warn">
                Some of it follows a paper&rsquo;s wording. Put these in your own words, or quote
                them with the page, before accepting:
              </p>
              <ul className="mt-1 list-disc pl-4 text-xs">
                {state.closeTo.map((c) => (
                  <li key={`${c.shortRef}-${c.overlapText}`}>
                    {c.shortRef}
                    {c.page ? `, p. ${c.page}` : ''}: &ldquo;
                    {c.overlapText.split(' ').slice(0, 12).join(' ')}&hellip;&rdquo;
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="mt-2 text-xs text-muted">
            Read it, then Accept or Discard. Nothing enters the chapter until you accept.
          </p>
        </>
      ) : null}

      <button
        type="button"
        className="mt-2 text-xs underline"
        onClick={() => setState({ phase: 'idle' })}
      >
        Close
      </button>
    </aside>
  );
}

/** Wraps the nodes the server built in a `draftBlock`, so nothing enters the chapter unaccepted. */
function insertDraft(
  editor: Editor,
  draftId: string,
  result: DraftResult,
  content: unknown[],
): void {
  // Needs-source notes become `needsSourceNote` atoms so B.6's accept turns them into visible text
  // the student must resolve, rather than letting a gap disappear into the prose.
  const notes = result.needsSource.map((text) => ({
    type: 'paragraph',
    content: [{ type: 'needsSourceNote', attrs: { text } }],
  }));

  // Each citation node arrives with a key of its own (ADR-0045); the label the worker rendered
  // is keyed by the prompt id, so it is matched to the node through the source and chunk.
  const renderedMap = (editor.storage as { citation?: { renderedMap?: Record<string, string> } })
    .citation?.renderedMap;
  if (renderedMap) {
    const bySource = new Map(
      result.citations.map((c) => [`${c.sourceId}|${c.chunkId ?? ''}`, c.rendered ?? '(Source)']),
    );
    const seed = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const n = node as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };
      if (n.type === 'citation' && n.attrs) {
        const label =
          bySource.get(`${String(n.attrs.sourceId)}|${String(n.attrs.chunkId ?? '')}`) ??
          bySource.get(`${String(n.attrs.sourceId)}|`);
        if (label) renderedMap[String(n.attrs.key)] = label;
      }
      for (const child of n.content ?? []) seed(child);
    };
    for (const block of content) seed(block);
  }

  // `insertDraft` builds a real node, so the JSON the server sent has to become ProseMirror nodes
  // first. Passing the JSON straight through silently produces an empty block.
  const nodes = [...content, ...notes].flatMap((json) => {
    try {
      return [editor.schema.nodeFromJSON(json as never)];
    } catch {
      // One malformed block must not lose the whole draft.
      return [];
    }
  });
  if (nodes.length === 0) return;

  editor.commands.insertDraft(draftId, nodes as never);
}
