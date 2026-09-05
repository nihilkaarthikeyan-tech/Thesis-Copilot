import { Editor, type JSONContent } from '@tiptap/core';
import type { CitationOptions } from '../src/editor/citation.js';
import { thesisExtensions } from '../src/editor/extensions.js';
import type {
  GhostEvent,
  GhostRequestPayload,
  GhostTextOptions,
} from '../src/editor/ghost-text.js';

export type FakeStream = {
  /** Events the fake will yield, in order. */
  events: GhostEvent[];
  /** Resolves each event only when `release()` is called, so tests control pacing. */
  paced?: boolean;
};

export type FakeRequest = {
  request: GhostTextOptions['request'];
  calls: Array<{ payload: GhostRequestPayload; signal: AbortSignal }>;
  release: () => void;
  aborted: () => boolean;
};

/** A controllable stand-in for the SSE transport. */
export function fakeRequest(stream: FakeStream): FakeRequest {
  const calls: FakeRequest['calls'] = [];
  let gate: (() => void) | null = null;
  let waiting: Promise<void> | null = null;

  const nextGate = () =>
    new Promise<void>((resolve) => {
      gate = resolve;
    });

  const request: GhostTextOptions['request'] = async function* (payload, signal) {
    calls.push({ payload, signal });
    for (const event of stream.events) {
      if (stream.paced) {
        waiting = nextGate();
        await waiting;
      } else {
        await Promise.resolve();
      }
      if (signal.aborted) return;
      yield event;
    }
  };

  return {
    request,
    calls,
    release: () => {
      gate?.();
      gate = null;
    },
    aborted: () => calls.some((c) => c.signal.aborted),
  };
}

export function createTestEditor(
  content: JSONContent | string = '<p></p>',
  ghost: Partial<GhostTextOptions> = {},
  outcomes: Array<{ suggestionId: string; outcome: string; keptChars: number }> = [],
  citation: CitationOptions = {},
): Editor {
  const element = document.createElement('div');
  document.body.appendChild(element);
  return new Editor({
    element,
    content,
    extensions: thesisExtensions({
      citation,
      ghostText: {
        chapterId: 'chapter-1',
        request: async function* () {},
        fadeMs: 0,
        onOutcome: (e) => outcomes.push(e),
        ...ghost,
      },
      resizableTables: false,
    }),
  });
}

/** Lets pending microtasks and the fake stream's awaits settle. */
export const tick = (n = 5) =>
  Array.from({ length: n }).reduce<Promise<void>>(
    (p) => p.then(() => new Promise((r) => setTimeout(r, 0))),
    Promise.resolve(),
  );

/**
 * Dispatches a real keydown on the editor DOM. TipTap's `editor.commands.keyboardShortcut` is a
 * capture-and-replay simulation that drops transaction metas and selection, so it cannot exercise
 * plugins that communicate through meta (ghost text does). ProseMirror handles this event exactly
 * as it would a student's keypress. Returns true if the editor prevented the default.
 */
export function pressKey(
  editor: Editor,
  key: string,
  modifiers: { alt?: boolean; shift?: boolean; ctrl?: boolean; meta?: boolean } = {},
): boolean {
  const event = new KeyboardEvent('keydown', {
    key,
    code: key.length === 1 ? `Digit${key}` : key,
    altKey: Boolean(modifiers.alt),
    shiftKey: Boolean(modifiers.shift),
    ctrlKey: Boolean(modifiers.ctrl),
    metaKey: Boolean(modifiers.meta),
    bubbles: true,
    cancelable: true,
  });
  editor.view.dom.dispatchEvent(event);
  return event.defaultPrevented;
}

/** Every text node with its provenance kind, in document order. */
export function provenanceRuns(
  editor: Editor,
): Array<{ text: string; kind: string; actionId: string | null }> {
  const runs: Array<{ text: string; kind: string; actionId: string | null }> = [];
  editor.state.doc.descendants((node) => {
    if (!node.isText) return;
    const mark = node.marks.find((m) => m.type.name === 'provenance');
    // Text with no mark (e.g. loaded content) reads as HUMAN, matching wordCountByProvenance.
    runs.push({
      text: node.text ?? '',
      kind: String(mark?.attrs.kind ?? 'HUMAN'),
      actionId: (mark?.attrs.actionId as string | null) ?? null,
    });
  });
  return runs;
}
