/**
 * Plain-text views of the document for prompts — PRD Appendix B.3 ("before" / "after" context)
 * and A.1 (citations shown to the model as `{{cite:KEY}}`).
 */

import type { Node as PmNode } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';

/** Rough tokenizer stand-in: ~4 characters per token (same assumption as packages/config). */
export const CHARS_PER_TOKEN = 4;

/** Text of one block, with citation nodes rendered as `{{cite:KEY}}` and notes as markers. */
export function blockText(node: PmNode): string {
  let out = '';
  node.forEach((child) => {
    if (child.isText) out += child.text ?? '';
    else if (child.type.name === 'citation') out += `{{cite:${String(child.attrs.key)}}}`;
    else if (child.type.name === 'needsSourceNote')
      out += `[[NEEDS SOURCE: ${String(child.attrs.text)}]]`;
    else if (child.type.name === 'hardBreak') out += '\n';
    else if (child.isTextblock) out += blockText(child);
    else if (child.content.size > 0) out += blockText(child);
  });
  return out;
}

/** Whole document as plain text, one block per line. */
export function documentText(doc: PmNode): string {
  const lines: string[] = [];
  doc.descendants((node) => {
    if (node.isTextblock) {
      lines.push(blockText(node));
      return false;
    }
    if (node.type.name === 'mathBlock') {
      lines.push(`$$${String(node.attrs.latex ?? '')}$$`);
      return false;
    }
    return true;
  });
  return lines.join('\n');
}

/**
 * `before` = text of the current block up to the cursor plus preceding blocks, newest first until
 * the token budget is spent; `after` = text after the cursor plus following blocks, up to its
 * budget (B.3).
 */
export function contextAround(
  state: EditorState,
  maxBeforeTokens: number,
  maxAfterTokens: number,
): { before: string; after: string } {
  const { $from } = state.selection;
  const block = $from.parent;
  const offset = $from.parentOffset;

  const beforeInBlock = blockText(block.cut(0, offset));
  const afterInBlock = blockText(block.cut(offset));

  const blocks: string[] = [];
  state.doc.descendants((node) => {
    if (node.isTextblock) {
      blocks.push(blockText(node));
      return false;
    }
    return true;
  });

  // Index of the current block among textblocks.
  let index = 0;
  let counter = 0;
  state.doc.descendants((node, pos) => {
    if (node.isTextblock) {
      if (pos + 1 <= $from.pos && $from.pos <= pos + node.nodeSize - 1) index = counter;
      counter++;
      return false;
    }
    return true;
  });

  const beforeBudget = maxBeforeTokens * CHARS_PER_TOKEN;
  const afterBudget = maxAfterTokens * CHARS_PER_TOKEN;

  let before = beforeInBlock;
  for (let i = index - 1; i >= 0 && before.length < beforeBudget; i--) {
    before = `${blocks[i] ?? ''}\n${before}`;
  }
  if (before.length > beforeBudget) before = before.slice(before.length - beforeBudget);

  let after = afterInBlock;
  for (let i = index + 1; i < blocks.length && after.length < afterBudget; i++) {
    after = `${after}\n${blocks[i] ?? ''}`;
  }
  if (after.length > afterBudget) after = after.slice(0, afterBudget);

  return { before, after };
}

/**
 * The section the cursor is in (ADR-0071): the nearest heading above it below the chapter title,
 * and the student's own text between that heading and the cursor. Draft mode used to send only
 * the chapter, so a draft under "Financial constraints" was written for "Chapter 1".
 *
 * Level-1 headings are skipped (each chapter starts with its own title as one), and a heading the
 * markdown shortcut left as literal text ("## Financial constraints") is read without its hashes.
 */
export function sectionUnderCursor(
  doc: PmNode,
  pos: number,
): { heading?: string; context: string } {
  let heading: string | undefined;
  let blocks: string[] = [];
  const end = Math.min(pos, doc.content.size);
  doc.nodesBetween(0, end, (node, at) => {
    if (!node.isTextblock) return true;
    if (at >= end) return false;
    const text = blockText(node).trim();
    const literal = /^#{2,6}\s+\S/.test(text);
    if ((node.type.name === 'heading' && Number(node.attrs.level ?? 1) > 1) || literal) {
      heading = text.replace(/^#+\s*/, '').slice(0, 200) || heading;
      blocks = [];
    } else if (node.type.name !== 'heading' && text) {
      blocks.push(text.replace(/\{\{cite:[^}]+\}\}/g, ' '));
    }
    return false;
  });
  const context = blocks.join(' ').replace(/\s+/g, ' ').trim().slice(-800);
  return heading ? { heading, context } : { context };
}
