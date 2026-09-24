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

import type { Editor } from '@tiptap/core';
import { useCallback, useEffect, useState } from 'react';
import { API_URL, ApiError, type ProblemDetails } from '@/lib/api';
import { parseSse } from '@/lib/sse';

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
  | { phase: 'refused'; reason: string }
  | { phase: 'error'; message: string }
  | { phase: 'done'; words: number; targetWords: number; short: boolean; needsSource: string[] };

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

  const run = useCallback(async () => {
    if (!editor || state.phase === 'working') return;
    setState({ phase: 'working', stage: 'retrieving' });

    try {
      const response = await fetch(`${API_URL}/api/v1/draft/section`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({ chapterId, outlineNodeId }),
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
          onUsageChange();
          setState({
            phase: 'done',
            words: Number(parsed.words ?? result.words),
            targetWords: Number(parsed.targetWords ?? 0),
            short: Boolean(parsed.short),
            needsSource: result.needsSource ?? [],
          });
          return;
        }
      }
    } catch (error) {
      setState({
        phase: 'error',
        message:
          error instanceof ApiError
            ? (error.problem.detail ?? error.problem.title)
            : 'The draft could not be started.',
      });
    }
  }, [editor, chapterId, outlineNodeId, onUsageChange, state.phase]);

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
    dom.addEventListener('keydown', onKeyDown);
    return () => dom.removeEventListener('keydown', onKeyDown);
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
          <p className="font-medium">This section has nothing to draft from.</p>
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

  const store = (editor.storage as { citation?: { renderedMap?: Record<string, string> } })
    .citation;
  if (store?.renderedMap) {
    for (const citation of result.citations) {
      store.renderedMap[citation.key] = citation.rendered ?? '(Source)';
    }
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
