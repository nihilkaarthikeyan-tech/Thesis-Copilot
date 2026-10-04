/**
 * Move a paragraph, heading, list, table or figure up or down past its neighbour with the
 * keyboard (2026-10-04, from the Jenni study, coverage-map row 20). Restructuring a chapter by
 * cut and paste loses the student's place and, for a table or an equation, is easy to get wrong.
 *
 * Mod-Shift-↑ / Mod-Shift-↓ (Ctrl on Windows, ⌘ on a Mac), the convention Notion and Google Docs
 * students already know; plain Ctrl-↑ moves the caret by paragraph in every browser and is left
 * alone. Whole top-level blocks move: a selection across three paragraphs moves all three. The
 * chapter title (a level-1 heading) is never moved past, and nothing moves while a suggestion is
 * on screen, so ghost text never ends up anchored in a block that has travelled.
 */

import { Extension } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { ghostTextKey } from './ghost-text.js';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    moveBlock: {
      /** Moves the top-level block(s) under the selection one place up or down. */
      moveBlock: (direction: 'up' | 'down') => ReturnType;
    };
  }
}

/** Start position of each top-level child of `doc`. */
function childStarts(doc: PmNode): number[] {
  const starts: number[] = [];
  doc.forEach((_node, offset) => {
    starts.push(offset);
  });
  return starts;
}

const isTitle = (node: PmNode | null | undefined): boolean =>
  node?.type.name === 'heading' && node.attrs.level === 1;

/**
 * Adds one move to `tr` and returns true, or returns false (leaving `tr` alone) when there is
 * nowhere to go. Exported for tests.
 */
export function moveBlockInto(
  state: EditorState,
  tr: Transaction,
  direction: 'up' | 'down',
): boolean {
  const { doc, selection } = state;
  const first = selection.$from.index(0);
  const last = selection.$to.index(0);
  const starts = childStarts(doc);
  const rangeStart = starts[first];
  const lastNode = doc.maybeChild(last);
  if (rangeStart === undefined || !lastNode) return false;
  const rangeEnd = (starts[last] ?? 0) + lastNode.nodeSize;

  // The title stays first, and is not itself moved.
  for (let i = first; i <= last; i++) if (isTitle(doc.child(i))) return false;

  if (direction === 'up') {
    const prev = doc.maybeChild(first - 1);
    const prevStart = starts[first - 1];
    if (!prev || prevStart === undefined || isTitle(prev)) return false;
    tr.delete(prevStart, prevStart + prev.nodeSize);
    tr.insert(rangeEnd - prev.nodeSize, prev);
  } else {
    const next = doc.maybeChild(last + 1);
    if (!next) return false;
    tr.delete(rangeEnd, rangeEnd + next.nodeSize);
    tr.insert(rangeStart, next);
  }
  tr.scrollIntoView();
  return true;
}

export const MoveBlock = Extension.create({
  name: 'moveBlock',

  addCommands() {
    return {
      moveBlock:
        (direction) =>
        ({ state, tr, dispatch }) => {
          const ghost = ghostTextKey.getState(state);
          if (ghost && ghost.status !== 'idle') return false;
          // A dry run (`can()`) must not touch the shared transaction.
          if (!dispatch) return moveBlockInto(state, state.tr, direction);
          return moveBlockInto(state, tr, direction);
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-ArrowUp': () => this.editor.commands.moveBlock('up'),
      'Mod-Shift-ArrowDown': () => this.editor.commands.moveBlock('down'),
    };
  },
});
