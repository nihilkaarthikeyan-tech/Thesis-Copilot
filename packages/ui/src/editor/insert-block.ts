/**
 * Inserting a block that is a single, selectable thing — a figure, a display equation.
 *
 * ProseMirror leaves such a node **selected** after it is inserted, and the next thing inserted
 * replaces the selection. In an editor that means: upload a figure, click "Insert table", and the
 * figure is gone. No message, nothing on screen to say it happened, and the student finds out when
 * they open the `.docx` they submitted. The same pair in the other order loses the equation.
 *
 * Both inserters had their own version of this and both had the bug, so it lives here now.
 *
 * ## Three ways to find the position, two of them wrong
 *
 * The whole job is "where did that node end up", and it is harder than it looks because
 * `replaceSelectionWith` may split the block the caret was in.
 *
 *   - `TextSelection.near(pos, 1)`. That static is inherited from `Selection.near`, whose
 *     `findFrom` returns a **NodeSelection** for a selectable node — so it put the selection
 *     straight back on the thing it was meant to move off.
 *   - Arithmetic on `tr.selection.to`, or `tr.mapping.map(at, 1)`. Both land at document level
 *     when the caret was in an empty paragraph and *inside the second half of the split* when it
 *     was mid-sentence. So the figure case worked and the equation case silently did not, which
 *     is the worst possible split between two call sites of the same helper.
 *   - The node itself. ProseMirror nodes are immutable values and the insert keeps the very
 *     instance it was given, so an identity search finds it wherever the split put it. Boring,
 *     and right in both documents.
 */

import type { Node as PmNode } from '@tiptap/pm/model';
import { TextSelection, type Transaction } from '@tiptap/pm/state';

/**
 * Inserts `node`, makes sure an empty `paragraph` follows it, and puts the caret in that
 * paragraph.
 *
 * The trailing paragraph is not only the fix: it is what a student wants next, somewhere to type
 * under the figure they just added. When splitting the caret's block has already produced an
 * empty paragraph there, that one is used rather than adding a second.
 *
 * Returns false when the node could not be placed or nothing can follow it, in which case the
 * transaction still carries the insert and the selection is left where ProseMirror put it.
 */
export function insertBlockWithCaretAfter(
  tr: Transaction,
  node: PmNode,
  paragraph: PmNode,
): boolean {
  tr.replaceSelectionWith(node, false);

  let after: number | null = null;
  tr.doc.descendants((candidate, pos) => {
    if (after !== null) return false;
    if (candidate === node) after = pos + candidate.nodeSize;
    return after === null;
  });
  if (after === null) return false;

  const $after = tr.doc.resolve(after);
  const next = $after.nodeAfter;
  if (next?.type === paragraph.type && next.content.size === 0) {
    tr.setSelection(TextSelection.create(tr.doc, after + 1));
    return true;
  }
  if (!$after.parent.canReplaceWith($after.index(), $after.index(), paragraph.type)) return false;

  tr.insert(after, paragraph);
  tr.setSelection(TextSelection.create(tr.doc, after + 1));
  return true;
}
