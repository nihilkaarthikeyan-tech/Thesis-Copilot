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

import { findDraft, sectionUnderCursor } from '@tc/ui';
import type { Editor } from '@tiptap/core';
import { useCallback, useEffect, useState } from 'react';
import { API_URL, ApiError, type ProblemDetails } from '@/lib/api';
import { parseSse } from '@/lib/sse';

/**
 * ADR-0073: anything outside the editor (the key bar's button, the section guide) asks for a
 * draft of the section under the cursor by dispatching this on `window`.
 */
export const DRAFT_SECTION_EVENT = 'tc:draft-section';

type DraftCitation = { key: string; sourceId: string; chunkId?: string; rendered?: string };

type DraftResult = {
  markdown: string;
  citations: DraftCitation[];
  needsSource: string[];
  words: number;
};

type State =
  | { phase: 'idle' }
  | { phase: 'working'; stage: string }
  | { phase: 'refused'; reason: string; title?: string }
  | { phase: 'error'; message: string }
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
  chapterId,
  outlineNodeId,
  onUsageChange,
}: {
  editor: Editor | null;
  chapterId: string;
  outlineNodeId: string;
  onUsageChange: () => void;
}) {
  const [state, setState] = useState<State>({ phase: 'idle' });
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
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'd' || !event.ctrlKey || !event.shiftKey) return;
      event.preventDefault();
      void run();
    };
    const dom = editor.view.dom;
    const onAsk = () => void run();
    dom.addEventListener('keydown', onKeyDown);
    window.addEventListener(DRAFT_SECTION_EVENT, onAsk);
    return () => {
      dom.removeEventListener('keydown', onKeyDown);
      window.removeEventListener(DRAFT_SECTION_EVENT, onAsk);
    };
  }, [editor, run]);

  if (state.phase === 'idle') return null;

  return (
    <aside
      data-testid="draft-status"
      className="fixed bottom-20 left-1/2 z-30 w-[30rem] max-w-[92vw] -translate-x-1/2 rounded-md border border-line bg-surface p-3 text-sm shadow-lg"
    >
      {state.phase === 'working' ? (
        <p className="text-muted">
          {state.stage === 'retrieving'
            ? 'Finding the sources for this section…'
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
