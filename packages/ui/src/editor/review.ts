/**
 * Review highlights — the in-editor half of the supervisor cycle (2026-09-21).
 *
 * The review queue (§5.7, D.2.4) is a list of things to answer, away from the text. That is the
 * right screen for working *through* feedback and the wrong one for writing with it: a student
 * rewriting chapter 3 cannot see which sentence their supervisor objected to without leaving the
 * editor. This puts the comments back on the words they are about.
 *
 * ## Why decorations, and not the `commentAnchor` mark
 *
 * Appendix B.2 reserves a `commentAnchor` mark for this, and it stays unused — see
 * `docs/ADR/0017-review-highlights-are-decorations.md`. In short: the server already re-finds a
 * comment's passage from its `quotedText` on every read, because the student keeps editing under
 * it. A stored mark would be a second, weaker answer to the same question — one that has to be
 * written on save, cleaned up on resolve, and that goes stale silently when the text moves.
 * A decoration is derived from whatever the document says right now and cannot be left behind.
 *
 * ## Why the range is found here rather than sent from the server
 *
 * `CommentView.anchor` carries positions, and they are computed from the *saved* chapter by a
 * walk that counts an inline atom as one position and its text as zero — close enough to scroll
 * to, off by a character or two for a highlight, and wrong outright for anything the student has
 * typed since the last save. Searching the live document for the quoted text is exact by
 * construction, and when the passage has genuinely gone, the search fails and the panel can say
 * so instead of underlining the wrong sentence.
 */

import { Extension } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export type ReviewAnchor = {
  /** The comment's id; goes on the decoration so a click can name it. */
  id: string;
  /** The passage the comment was written about, as the comment recorded it. */
  text: string;
  /** A comment carrying a suggested revision is drawn differently — there is something to accept. */
  hasSuggestion?: boolean;
  /**
   * The server's own idea of where this is, from `CommentView.anchor.from`.
   *
   * Not trusted for the range — see the note above — but exactly right for breaking a tie when
   * the quoted sentence occurs more than once in the chapter, which the first-match rule would
   * otherwise resolve by luck.
   */
  near?: number;
};

export type ReviewHighlightsOptions = {
  anchors: ReviewAnchor[];
  /** The one being read in the panel, drawn stronger than the rest. */
  activeId: string | null;
  /** Clicking a highlighted passage. */
  onSelect?: (commentId: string) => void;
};

export const reviewHighlightsKey = new PluginKey<ReviewHighlightsOptions>('reviewHighlights');

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    reviewHighlights: {
      /** Replaces the whole set; the panel owns the list and this draws it. */
      setReviewAnchors: (anchors: ReviewAnchor[], activeId?: string | null) => ReturnType;
      /** Scrolls to a comment's passage and selects it. False when the passage is gone. */
      goToReviewAnchor: (commentId: string) => ReturnType;
    };
  }
}

/** One character of the document, and where it is. */
type TextIndex = { text: string; pos: number[] };

/**
 * The document's text with a position for every character, whitespace collapsed.
 *
 * Collapsing matters because a comment's `quotedText` came back through JSON, a `.docx` import or
 * a supervisor's paste, and any of those can normalise a newline into a space. Both sides are
 * collapsed the same way so the needle and the haystack agree.
 *
 * An inline atom — a citation, a cross-reference — contributes no text, which is the same
 * accounting `packages/retrieval` uses: a citation's label is rendered from storage and is not in
 * the document, so including it would make this disagree with the text the comment quoted.
 */
export function textIndexOf(doc: PmNode): TextIndex {
  const chars: string[] = [];
  const pos: number[] = [];
  let pendingSpace = false;

  const push = (ch: string, at: number) => {
    if (/\s/.test(ch)) {
      // Only remember that a gap happened; it is emitted before the next real character, so the
      // index never ends on trailing whitespace.
      if (chars.length > 0) pendingSpace = true;
      return;
    }
    if (pendingSpace) {
      chars.push(' ');
      pos.push(at);
      pendingSpace = false;
    }
    chars.push(ch);
    pos.push(at);
  };

  doc.descendants((node, at) => {
    if (node.isText) {
      const text = node.text ?? '';
      for (let i = 0; i < text.length; i++) push(text[i] as string, at + i);
      return false;
    }
    if (node.isBlock && chars.length > 0) pendingSpace = true;
    return true;
  });

  return { text: chars.join(''), pos };
}

/** The same collapsing, for the needle. */
export function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** How much of a changed sentence still has to match for the highlight to be worth drawing. */
const PREFIX = 40;

/** Every start offset of `needle` in `haystack`. */
function occurrences(haystack: string, needle: string): number[] {
  const out: number[] = [];
  for (let at = haystack.indexOf(needle); at > -1; at = haystack.indexOf(needle, at + 1)) {
    out.push(at);
  }
  return out;
}

/**
 * Where a passage is in the live document, or null.
 *
 * The exact text first. Failing that, its opening — a supervisor quotes a sentence and the student
 * then rewrites its end, which is precisely when they most want to see where the comment was. The
 * prefix has to be long enough to be unique-ish, so a short quote that no longer matches exactly
 * is reported missing rather than guessed at.
 *
 * `near` breaks a tie. A thesis repeats sentences — a definition restated in the conclusion, a
 * caption reused — and picking the first is picking by luck.
 */
export function findPassage(
  doc: PmNode,
  quoted: string,
  near?: number,
): { from: number; to: number } | null {
  const needle = collapse(quoted);
  if (needle.length === 0) return null;
  const index = textIndexOf(doc);

  const range = (start: number, length: number) => {
    const first = index.pos[start];
    const last = index.pos[start + length - 1];
    if (first === undefined || last === undefined) return null;
    return { from: first, to: last + 1 };
  };

  const pick = (starts: number[], length: number) => {
    if (starts.length === 0) return null;
    if (starts.length === 1 || near === undefined) return range(starts[0] as number, length);
    const best = starts.reduce((a, b) =>
      Math.abs((index.pos[a] ?? 0) - near) <= Math.abs((index.pos[b] ?? 0) - near) ? a : b,
    );
    return range(best, length);
  };

  const exact = pick(occurrences(index.text, needle), needle.length);
  if (exact) return exact;

  if (needle.length <= PREFIX) return null;
  return pick(occurrences(index.text, needle.slice(0, PREFIX)), PREFIX);
}

function decorate(doc: PmNode, options: ReviewHighlightsOptions): DecorationSet {
  const decorations: Decoration[] = [];
  for (const anchor of options.anchors) {
    const found = findPassage(doc, anchor.text, anchor.near);
    if (!found) continue;
    const classes = ['review-anchor'];
    if (anchor.hasSuggestion) classes.push('review-anchor-suggested');
    if (anchor.id === options.activeId) classes.push('review-anchor-active');
    decorations.push(
      Decoration.inline(found.from, found.to, {
        class: classes.join(' '),
        'data-comment-id': anchor.id,
      }),
    );
  }
  return DecorationSet.create(doc, decorations);
}

export const ReviewHighlights = Extension.create<ReviewHighlightsOptions>({
  name: 'reviewHighlights',

  addOptions() {
    return { anchors: [], activeId: null };
  },

  addCommands() {
    return {
      setReviewAnchors:
        (anchors, activeId = null) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(reviewHighlightsKey, { anchors, activeId }));
          return true;
        },
      goToReviewAnchor:
        (commentId) =>
        ({ editor, chain }) => {
          const state = reviewHighlightsKey.getState(editor.state);
          const anchor = state?.anchors.find((a) => a.id === commentId);
          if (!anchor) return false;
          const found = findPassage(editor.state.doc, anchor.text, anchor.near);
          if (!found) return false;
          return chain().focus().setTextSelection(found).scrollIntoView().run();
        },
    };
  },

  addProseMirrorPlugins() {
    const extension = this;
    return [
      new Plugin<ReviewHighlightsOptions>({
        key: reviewHighlightsKey,
        state: {
          init: () => ({
            anchors: extension.options.anchors,
            activeId: extension.options.activeId,
          }),
          apply(tr, value) {
            const next = tr.getMeta(reviewHighlightsKey) as
              | Pick<ReviewHighlightsOptions, 'anchors' | 'activeId'>
              | undefined;
            return next ? { ...value, ...next } : value;
          },
        },
        props: {
          decorations(state) {
            const value = reviewHighlightsKey.getState(state);
            if (!value || value.anchors.length === 0) return DecorationSet.empty;
            return decorate(state.doc, value);
          },
          handleClick(view, pos) {
            const onSelect = extension.options.onSelect;
            if (!onSelect) return false;
            const value = reviewHighlightsKey.getState(view.state);
            if (!value) return false;
            for (const anchor of value.anchors) {
              const found = findPassage(view.state.doc, anchor.text, anchor.near);
              if (found && pos >= found.from && pos <= found.to) {
                onSelect(anchor.id);
                // Not handled: the click should still place the caret, because the student was
                // very likely about to edit the sentence they just clicked.
                return false;
              }
            }
            return false;
          },
        },
      }),
    ];
  },
});
