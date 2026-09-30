/**
 * Ghost-text plugin — PRD Appendix B.3 (Assist mode), FR-4.3, keymap §6.3.
 *
 * Ghost text is NEVER part of the document. It lives in plugin state and is drawn as a widget
 * decoration at the cursor, so undo history, autosave, word counts and provenance never see
 * unaccepted text (B.1). Accepting inserts real text nodes carrying `provenance ASSIST`.
 *
 * The transport is injected (`options.request`): the app passes an SSE reader, tests pass a fake.
 */

import { Extension, type JSONContent } from '@tiptap/core';
import { Fragment, type Node as PmNode, type Schema } from '@tiptap/pm/model';
import { type EditorState, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { nanoid } from 'nanoid';
import { contextAround } from './text.js';

export type GhostStatus = 'idle' | 'requesting' | 'streaming' | 'shown';

export type SuggestionOutcome = 'ACCEPTED' | 'PARTIAL' | 'REJECTED' | 'CANCELLED';

/** One citation the server resolved for a `{{cite:KEY}}` in the suggestion (B.8 `done` event). */
export type SuggestionCitation = {
  key: string;
  sourceId: string | null;
  chunkId: string | null;
  rendered: string;
};

export type GhostRequestPayload = {
  chapterId: string;
  before: string;
  after: string;
  guided?: string;
  cursorContext: { blockType: string };
};

export type GhostEvent =
  | { type: 'start'; suggestionId: string }
  | { type: 'token'; t: string }
  | {
      type: 'done';
      citations: SuggestionCitation[];
      /**
       * The text after A.1 post-processing, when the server changed it (a stripped citation, a
       * third sentence cut). Replaces what was streamed; absent means the stream was final.
       */
      text?: string;
      /** §6.2 empty-grounding state: false when nothing was retrieved for this call. */
      grounded?: boolean;
      pinned?: number;
      usage?: unknown;
      ttfbMs?: number;
      latencyMs?: number;
    }
  | {
      type: 'error';
      code: string;
      message: string;
      /** CAP_EXCEEDED only: when the cap resets, ISO 8601, for the §6.2 cap-exceeded state. */
      resetsAt?: string;
      action?: string;
      cap?: number;
    };

export type GhostTextOptions = {
  chapterId: string;
  /** Opens the stream. Must honour `signal` (B.3: cancel aborts the request). */
  request: (payload: GhostRequestPayload, signal: AbortSignal) => AsyncIterable<GhostEvent>;
  onOutcome?: (event: {
    suggestionId: string;
    outcome: SuggestionOutcome;
    keptChars: number;
    shownChars: number;
  }) => void;
  onError?: (error: {
    code: string;
    message: string;
    resetsAt?: string;
    action?: string;
    cap?: number;
  }) => void;
  /** Fires on `done` with what the server knew about grounding, for the §6.2 hint. */
  onDone?: (info: { grounded: boolean; pinned: number; empty: boolean }) => void;
  onTiming?: (timing: { ttfbMs: number; latencyMs: number }) => void;
  /**
   * FR-4.6: automatic-suggest. When true, a suggestion is requested `autoSuggestIdleMs` after the
   * student stops typing. Off by default; the same cap applies. B.3's conditions still hold — the
   * timer is reset by every keystroke and cancelled when a suggestion is already open.
   */
  autoSuggest?: boolean;
  /** FR-4.6: "fires 800 ms after typing pause". */
  autoSuggestIdleMs?: number;
  /** Guided suggestion (Shift+→): asks the student for an instruction. Null cancels. */
  promptForInstruction?: () => Promise<string | null>;
  /** Milliseconds of accepted-text fade (§6.2: 400). 0 disables, e.g. prefers-reduced-motion. */
  fadeMs: number;
  maxBeforeTokens: number;
  maxAfterTokens: number;
};

export type GhostState = {
  status: GhostStatus;
  suggestionId: string | null;
  text: string;
  anchorPos: number | null;
  guided: boolean;
  abort: AbortController | null;
  citations: SuggestionCitation[];
  /** Chars accepted word-by-word so far (Alt+→), for PARTIAL reporting. */
  keptChars: number;
  shownChars: number;
  /** Range that just received accepted text; drawn with a 400 ms background fade. */
  fade: { from: number; to: number } | null;
  decorations: DecorationSet;
};

export const ghostTextKey = new PluginKey<GhostState>('ghostText');

type GhostMeta =
  | {
      type: 'request';
      anchorPos: number;
      abort: AbortController;
      guided: boolean;
      suggestionId: string;
    }
  | { type: 'start'; suggestionId: string }
  | { type: 'token'; t: string }
  | { type: 'done'; citations: SuggestionCitation[]; text?: string }
  | { type: 'accepted'; fade: { from: number; to: number } | null }
  | {
      type: 'acceptWord';
      keptChars: number;
      remaining: string;
      anchorPos: number;
      fade: { from: number; to: number } | null;
    }
  | { type: 'reset' }
  | { type: 'fadeEnd' };

const IDLE: Omit<GhostState, 'decorations'> = {
  status: 'idle',
  suggestionId: null,
  text: '',
  anchorPos: null,
  guided: false,
  abort: null,
  citations: [],
  keptChars: 0,
  shownChars: 0,
  fade: null,
};

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    ghostText: {
      requestSuggestion: (instruction?: string) => ReturnType;
      acceptSuggestion: () => ReturnType;
      acceptSuggestionWord: () => ReturnType;
      dismissSuggestion: () => ReturnType;
    };
  }
}

/** Blocks where a suggestion may be requested (B.3). */
function cursorEligible(state: EditorState): boolean {
  const { selection } = state;
  if (!selection.empty) return false;
  const $from = selection.$from;
  if ($from.parent.type.name !== 'paragraph') return false;

  for (let depth = $from.depth; depth > 0; depth--) {
    const name = $from.node(depth).type.name;
    if (name === 'codeBlock' || name === 'mathBlock' || name === 'tableHeader') return false;
    if (name === 'draftBlock' && $from.node(depth).attrs.status !== 'accepted') return false;
  }
  return true;
}

const CITE_RE = /\{\{cite:([^}]+)\}\}/g;

/** The character just before `pos` in its textblock, or '' at the start of one. */
export function charBefore(doc: PmNode, pos: number): string {
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  if ($pos.parentOffset === 0) return '';
  // An inline node (a citation) counts as a word: a suggestion after it needs a space too.
  return $pos.parent.textBetween($pos.parentOffset - 1, $pos.parentOffset, undefined, 'x');
}

/**
 * A suggestion joined to the text before it with exactly the space it needs: one space after a
 * word or a sentence end, none at the start of a paragraph, after existing whitespace or an
 * opening bracket, or when the suggestion itself starts with punctuation that attaches to the
 * previous word (",", ".", ";", ":", ")" …).
 */
export function spaceBefore(text: string, previous: string): string {
  const trimmed = text.replace(/^[ \t]+/, '');
  if (trimmed.length === 0) return trimmed;
  if (previous === '' || /\s/.test(previous) || /[([{“‘"'—–-]/.test(previous)) {
    return trimmed;
  }
  if (/^[,.;:!?)\]}”’%]/.test(trimmed)) return trimmed;
  return ` ${trimmed}`;
}

/**
 * Turns suggestion text into nodes: text carrying `provenance ASSIST`, and a `citation` node for
 * each `{{cite:KEY}}` the server resolved (B.3 accept-all).
 */
export function suggestionToFragment(
  schema: Schema,
  text: string,
  suggestionId: string,
  citations: SuggestionCitation[],
): Fragment {
  const provenance = schema.marks.provenance?.create({ kind: 'ASSIST', actionId: suggestionId });
  const marks = provenance ? [provenance] : [];
  const nodes: PmNode[] = [];
  const byKey = new Map(citations.map((c) => [c.key, c]));

  let last = 0;
  for (const match of text.matchAll(CITE_RE)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push(schema.text(text.slice(last, index), marks));
    const key = match[1] ?? '';
    const citation = byKey.get(key);
    const citationType = schema.nodes.citation;
    if (citation && citationType) {
      nodes.push(
        citationType.create({
          key: citation.key,
          sourceId: citation.sourceId,
          chunkId: citation.chunkId,
        }),
      );
    }
    // Unresolved keys are dropped: PRD §10.6 strips citations not in the retrieved set.
    last = index + match[0].length;
  }
  if (last < text.length) nodes.push(schema.text(text.slice(last), marks));

  return Fragment.fromArray(nodes);
}

/**
 * What the student sees in grey. The suggestion text keeps its `{{cite:KEY}}` markers (accepting
 * turns each into a citation node), but drawn raw they showed the student the marker itself,
 * "{{cite:S1#c1}}", found on 2026-09-27 while photographing the editor. Each marker is drawn as
 * the label the server resolved for it; one it did not resolve is dropped, as accepting drops it;
 * and while streaming, a marker that has only half arrived is held back rather than flashed.
 */
export function ghostDisplayText(text: string, citations: readonly SuggestionCitation[]): string {
  const byKey = new Map(citations.map((c) => [c.key, c.rendered]));
  const open = text.lastIndexOf('{{');
  const complete = open !== -1 && text.indexOf('}}', open) === -1 ? text.slice(0, open) : text;
  return complete
    .replace(CITE_RE, (_marker, key: string) => {
      const rendered = byKey.get(key);
      return rendered ? ` ${rendered}` : '';
    })
    .replace(/ {2,}/g, ' ')
    .replace(/ ([.,;:])/g, '$1');
}

function buildDecorations(
  state: EditorState,
  ghost: Omit<GhostState, 'decorations'>,
): DecorationSet {
  const decorations: Decoration[] = [];

  if (ghost.anchorPos !== null && ghost.text && ghost.status !== 'idle') {
    decorations.push(
      Decoration.widget(
        ghost.anchorPos,
        () => {
          const span = document.createElement('span');
          span.className = 'ghost';
          span.setAttribute('contenteditable', 'false');
          span.setAttribute('aria-live', 'polite');
          span.setAttribute('role', 'status');
          span.setAttribute('aria-label', 'suggestion available');
          // `streaming` while tokens arrive, `shown` once the text is final. Tab is inert until
          // then — accepting half a sentence would put half a sentence in the thesis — so this is
          // the signal anything driving the editor has to wait for. It was only visible on a
          // development-only overlay, which a production build (and so CI) does not render.
          span.dataset.status = ghost.status;
          span.style.userSelect = 'none';
          span.textContent = ghostDisplayText(ghost.text, ghost.citations);
          return span;
        },
        // The status is in the key so the widget is redrawn when streaming ends, not only when
        // the text grows; otherwise `data-status` would keep saying `streaming` for ever.
        { side: 1, key: `ghost-${ghost.suggestionId}-${ghost.text.length}-${ghost.status}` },
      ),
    );
  }

  if (ghost.fade && ghost.fade.to > ghost.fade.from) {
    decorations.push(
      Decoration.inline(ghost.fade.from, ghost.fade.to, { class: 'ghost-accepted' }),
    );
  }

  return DecorationSet.create(state.doc, decorations);
}

export const GhostText = Extension.create<GhostTextOptions>({
  name: 'ghostText',
  // Registered before list and table extensions so Tab is ours only while a suggestion is shown
  // (B.3 keymap precedence). TipTap orders keymaps by descending priority; lists use the default.
  priority: 1000,

  addOptions() {
    return {
      chapterId: '',
      request: () => {
        throw new Error('ghostText: options.request is not configured');
      },
      fadeMs: 400,
      maxBeforeTokens: 1200,
      maxAfterTokens: 300,
    };
  },

  addStorage() {
    return {
      lastTiming: null as { ttfbMs: number; latencyMs: number } | null,
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    const options = this.options;

    const report = (
      ghost: Omit<GhostState, 'decorations'>,
      outcome: SuggestionOutcome,
      keptChars: number,
    ) => {
      if (ghost.suggestionId) {
        options.onOutcome?.({
          suggestionId: ghost.suggestionId,
          outcome,
          keptChars,
          shownChars: ghost.shownChars,
        });
      }
    };

    return [
      new Plugin<GhostState>({
        key: ghostTextKey,
        state: {
          init: (_config, state) => ({ ...IDLE, decorations: DecorationSet.create(state.doc, []) }),
          apply(tr, prev, _oldState, newState) {
            const meta = tr.getMeta(ghostTextKey) as GhostMeta | undefined;
            let next: Omit<GhostState, 'decorations'> = prev;

            if (meta) {
              switch (meta.type) {
                case 'request':
                  next = {
                    ...IDLE,
                    status: 'requesting',
                    anchorPos: meta.anchorPos,
                    abort: meta.abort,
                    guided: meta.guided,
                    suggestionId: meta.suggestionId,
                  };
                  break;
                case 'start':
                  next = { ...prev, suggestionId: meta.suggestionId };
                  break;
                case 'token': {
                  const text = prev.text + meta.t;
                  next = { ...prev, status: 'streaming', text, shownChars: text.length };
                  break;
                }
                case 'done': {
                  // The server's post-processed text wins over what streamed (A.1 steps 1–3).
                  // A.1 tells the model "do not add a leading space; the editor handles spacing",
                  // and until 2026-09-30 nothing did: every accepted suggestion was glued to the
                  // sentence before it ("Hastelloy EDM.This synthesis"). The space is decided
                  // here, against the character actually before the cursor.
                  const finalText = spaceBefore(
                    meta.text ?? prev.text,
                    prev.anchorPos === null ? '' : charBefore(newState.doc, prev.anchorPos),
                  );
                  next =
                    finalText.length === 0
                      ? { ...IDLE }
                      : { ...prev, text: finalText, status: 'shown', citations: meta.citations };
                  break;
                }
                case 'accepted':
                  next = { ...IDLE, fade: meta.fade };
                  break;
                case 'acceptWord':
                  next = {
                    ...prev,
                    text: meta.remaining,
                    anchorPos: meta.anchorPos,
                    keptChars: meta.keptChars,
                    fade: meta.fade,
                  };
                  break;
                case 'reset':
                  next = { ...IDLE, fade: prev.fade };
                  break;
                case 'fadeEnd':
                  next = { ...prev, fade: null };
                  break;
              }
            } else if (
              prev.status !== 'idle' &&
              (tr.docChanged ||
                (tr.selectionSet && !(tr.selection.empty && tr.selection.from === prev.anchorPos)))
            ) {
              // B.3 cancel: any transaction that changes the doc or moves the selection while a
              // request is open aborts it. Typing is the common case.
              //
              // "Moves" means the cursor left the anchor. Real browsers dispatch selection-only
              // transactions at the SAME position after the widget is drawn (Chrome fires
              // selectionchange when the DOM changes under the caret); those must not count, or
              // every suggestion is rejected the moment it appears.
              prev.abort?.abort();
              report(prev, prev.text ? 'REJECTED' : 'CANCELLED', prev.keptChars);
              next = { ...IDLE, fade: prev.fade };
            } else if (prev.fade && tr.docChanged) {
              next = {
                ...prev,
                fade: { from: tr.mapping.map(prev.fade.from), to: tr.mapping.map(prev.fade.to) },
              };
            }

            if (next.anchorPos !== null && tr.docChanged && !meta) {
              next = { ...next, anchorPos: tr.mapping.map(next.anchorPos) };
            }

            return { ...next, decorations: buildDecorations(newState, next) };
          },
        },
        props: {
          decorations(state) {
            return ghostTextKey.getState(state)?.decorations ?? null;
          },
        },
      }),
      /**
       * FR-4.6: automatic-suggest. A timer that every document change resets, so it can only fire
       * after a real pause; it never fires while a suggestion is open or a request is in flight
       * (B.3's conditions), and the request goes through the same command and the same cap.
       */
      new Plugin({
        key: new PluginKey('ghostTextAutoSuggest'),
        view: () => {
          let timer: ReturnType<typeof setTimeout> | null = null;
          const clear = () => {
            if (timer) clearTimeout(timer);
            timer = null;
          };
          return {
            update: (currentView, previous) => {
              if (!options.autoSuggest) return clear();
              if (!currentView.state.doc.eq(previous.doc)) {
                clear();
                const idle = options.autoSuggestIdleMs ?? 800;
                timer = setTimeout(() => {
                  const ghost = ghostTextKey.getState(currentView.state);
                  const selection = currentView.state.selection;
                  if (ghost && ghost.status !== 'idle') return;
                  if (!selection.empty || !currentView.hasFocus()) return;
                  editor.commands.requestSuggestion();
                }, idle);
              }
            },
            destroy: clear,
          };
        },
      }),
    ];
  },

  addCommands() {
    const options = this.options;
    const storage = this.storage;

    const runStream = async (
      editor: typeof this.editor,
      payload: GhostRequestPayload,
      abort: AbortController,
      clientId: string,
    ) => {
      const startedAt = Date.now();
      let firstTokenAt: number | null = null;
      try {
        for await (const event of options.request(payload, abort.signal)) {
          if (abort.signal.aborted) return;
          const current = ghostTextKey.getState(editor.state);
          // The plugin may have reset (student typed) between events.
          if (!current || current.status === 'idle' || current.abort !== abort) return;

          if (event.type === 'start') {
            editor.view.dispatch(
              editor.state.tr.setMeta(ghostTextKey, {
                type: 'start',
                suggestionId: event.suggestionId,
              }),
            );
          } else if (event.type === 'token') {
            if (firstTokenAt === null) firstTokenAt = Date.now();
            editor.view.dispatch(
              editor.state.tr.setMeta(ghostTextKey, { type: 'token', t: event.t }),
            );
          } else if (event.type === 'done') {
            const timing = {
              ttfbMs: event.ttfbMs ?? (firstTokenAt ?? Date.now()) - startedAt,
              latencyMs: event.latencyMs ?? Date.now() - startedAt,
            };
            storage.lastTiming = timing;
            options.onTiming?.(timing);
            options.onDone?.({
              grounded: event.grounded ?? true,
              pinned: event.pinned ?? 0,
              empty: (event.text ?? '').length === 0 && event.citations.length === 0,
            });
            // PHASES 3.5: the label the server rendered for each resolved key ("(Kumar 2021)")
            // goes into the citation store, so the node inserted on Tab shows it rather than the
            // placeholder. The document itself stores only the key and ids (B.2, B.5).
            const citationStore = (
              editor.storage as { citation?: { renderedMap?: Record<string, string> } }
            ).citation;
            if (citationStore?.renderedMap) {
              for (const citation of event.citations) {
                if (citation.rendered) citationStore.renderedMap[citation.key] = citation.rendered;
              }
            }
            editor.view.dispatch(
              editor.state.tr.setMeta(ghostTextKey, {
                type: 'done',
                citations: event.citations,
                ...(typeof event.text === 'string' ? { text: event.text } : {}),
              }),
            );
          } else if (event.type === 'error') {
            options.onError?.({
              code: event.code,
              message: event.message,
              ...(event.resetsAt ? { resetsAt: event.resetsAt } : {}),
              ...(event.action ? { action: event.action } : {}),
              ...(typeof event.cap === 'number' ? { cap: event.cap } : {}),
            });
            editor.view.dispatch(editor.state.tr.setMeta(ghostTextKey, { type: 'reset' }));
          }
        }
      } catch (error) {
        if (abort.signal.aborted) return;
        options.onError?.({
          code: 'STREAM_FAILED',
          message: error instanceof Error ? error.message : String(error),
        });
        const current = ghostTextKey.getState(editor.state);
        if (current && current.abort === abort) {
          editor.view.dispatch(editor.state.tr.setMeta(ghostTextKey, { type: 'reset' }));
        }
      }
      void clientId;
    };

    const scheduleFadeEnd = (editor: typeof this.editor) => {
      if (options.fadeMs <= 0) return;
      setTimeout(() => {
        if (editor.isDestroyed) return;
        if (ghostTextKey.getState(editor.state)?.fade) {
          editor.view.dispatch(editor.state.tr.setMeta(ghostTextKey, { type: 'fadeEnd' }));
        }
      }, options.fadeMs);
    };

    return {
      requestSuggestion:
        (instruction) =>
        ({ state, tr, dispatch, editor }) => {
          const ghost = ghostTextKey.getState(state);
          if (ghost?.status !== 'idle') return false;
          if (!cursorEligible(state)) return false;

          const abort = new AbortController();
          const suggestionId = `client-${nanoid(10)}`;
          const anchorPos = state.selection.from;
          const { before, after } = contextAround(
            state,
            options.maxBeforeTokens,
            options.maxAfterTokens,
          );

          if (!dispatch) return true;
          tr.setMeta(ghostTextKey, {
            type: 'request',
            anchorPos,
            abort,
            guided: Boolean(instruction),
            suggestionId,
          } satisfies GhostMeta);

          void runStream(
            editor,
            {
              chapterId: options.chapterId,
              before,
              after,
              ...(instruction ? { guided: instruction } : {}),
              cursorContext: { blockType: state.selection.$from.parent.type.name },
            },
            abort,
            suggestionId,
          );
          return true;
        },

      acceptSuggestion:
        () =>
        ({ state, tr, dispatch, editor }) => {
          const ghost = ghostTextKey.getState(state);
          if (ghost?.status !== 'shown' || ghost.anchorPos === null || !ghost.suggestionId) {
            return false;
          }
          const fragment = suggestionToFragment(
            state.schema,
            ghost.text,
            ghost.suggestionId,
            ghost.citations,
          );
          const from = ghost.anchorPos;
          const to = from + fragment.size;
          if (!dispatch) return true;

          tr.insert(from, fragment);
          tr.setSelection(TextSelection.create(tr.doc, to));
          const fade = options.fadeMs > 0 ? { from, to } : null;
          tr.setMeta(ghostTextKey, { type: 'accepted', fade } satisfies GhostMeta);
          tr.setMeta('provenance-skip', true);

          options.onOutcome?.({
            suggestionId: ghost.suggestionId,
            outcome: 'ACCEPTED',
            keptChars: ghost.keptChars + ghost.text.length,
            shownChars: ghost.shownChars,
          });
          scheduleFadeEnd(editor);
          return true;
        },

      acceptSuggestionWord:
        () =>
        ({ state, tr, dispatch, editor }) => {
          const ghost = ghostTextKey.getState(state);
          if (ghost?.status !== 'shown' || ghost.anchorPos === null || !ghost.suggestionId) {
            return false;
          }
          // `\s*` first: the suggestion may begin with the joining space `spaceBefore` added.
          const match = /^\s*\S+\s*/.exec(ghost.text);
          if (!match) return false;
          const word = match[0];
          const remaining = ghost.text.slice(word.length);

          const fragment = suggestionToFragment(
            state.schema,
            word,
            ghost.suggestionId,
            ghost.citations,
          );
          const from = ghost.anchorPos;
          const to = from + fragment.size;
          const keptChars = ghost.keptChars + word.length;
          if (!dispatch) return true;

          tr.insert(from, fragment);
          tr.setSelection(TextSelection.create(tr.doc, to));
          tr.setMeta('provenance-skip', true);

          if (remaining.length === 0) {
            tr.setMeta(ghostTextKey, {
              type: 'accepted',
              fade: options.fadeMs > 0 ? { from, to } : null,
            });
            options.onOutcome?.({
              suggestionId: ghost.suggestionId,
              outcome: 'ACCEPTED',
              keptChars,
              shownChars: ghost.shownChars,
            });
          } else {
            tr.setMeta(ghostTextKey, {
              type: 'acceptWord',
              keptChars,
              remaining,
              anchorPos: to,
              fade: options.fadeMs > 0 ? { from, to } : null,
            } satisfies GhostMeta);
          }
          scheduleFadeEnd(editor);
          return true;
        },

      dismissSuggestion:
        () =>
        ({ state, tr, dispatch }) => {
          const ghost = ghostTextKey.getState(state);
          if (!ghost || ghost.status === 'idle') return false;
          ghost.abort?.abort();
          if (ghost.suggestionId) {
            options.onOutcome?.({
              suggestionId: ghost.suggestionId,
              outcome: ghost.keptChars > 0 ? 'PARTIAL' : ghost.text ? 'REJECTED' : 'CANCELLED',
              keptChars: ghost.keptChars,
              shownChars: ghost.shownChars,
            });
          }
          if (dispatch) tr.setMeta(ghostTextKey, { type: 'reset' } satisfies GhostMeta);
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    const shown = (state: EditorState) => ghostTextKey.getState(state)?.status === 'shown';
    const open = (state: EditorState) => ghostTextKey.getState(state)?.status !== 'idle';

    return {
      'Mod-/': ({ editor }) => editor.commands.requestSuggestion(),
      // Consumed only while a suggestion is shown; otherwise falls through to list/table handling.
      Tab: ({ editor }) => (shown(editor.state) ? editor.commands.acceptSuggestion() : false),
      ArrowRight: ({ editor }) =>
        shown(editor.state) ? editor.commands.acceptSuggestion() : false,
      'Alt-ArrowRight': ({ editor }) =>
        shown(editor.state) ? editor.commands.acceptSuggestionWord() : false,
      Escape: ({ editor }) => (open(editor.state) ? editor.commands.dismissSuggestion() : false),
      'Shift-ArrowRight': ({ editor }) => {
        if (open(editor.state) || !this.options.promptForInstruction) return false;
        void this.options.promptForInstruction().then((instruction) => {
          if (editor.isDestroyed) return;
          // The input took focus; give it back so Tab/Esc land on the suggestion, not the form.
          editor.view.focus();
          if (instruction) editor.commands.requestSuggestion(instruction);
        });
        return true;
      },
    };
  },
});

/** Convenience for tests and the dev overlay. */
export function getGhostState(editor: { state: EditorState }): GhostState | undefined {
  return ghostTextKey.getState(editor.state);
}

/** True if any text in the JSON document equals or contains the ghost text (B.9 test 1 helper). */
export function jsonContainsText(json: JSONContent, needle: string): boolean {
  if (!needle) return false;
  if (json.type === 'text' && typeof json.text === 'string' && json.text.includes(needle))
    return true;
  return (json.content ?? []).some((child) => jsonContainsText(child, needle));
}
