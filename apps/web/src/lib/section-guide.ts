/**
 * The Sections panel's working parts (ADR-0072), kept apart from React so they can be tested on
 * a bare ProseMirror document.
 *
 * Everything here moves the cursor or adds a heading the student asked for. Nothing rewrites or
 * moves text the student wrote.
 */

import { headingKey } from '@tc/types';
import type { Node as PmNode } from '@tiptap/pm/model';

/** A scope note as two or three short lines: its sentences, the first three. */
export function scopeBullets(note: string | null | undefined, max = 3): string[] {
  return (note ?? '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, max);
}

/** The position of the heading (level 2 or below) whose words match `title`, or null. */
export function findSectionHeading(doc: PmNode, title: string): number | null {
  const key = headingKey(title);
  if (!key) return null;
  let found: number | null = null;
  doc.forEach((node, offset) => {
    if (found !== null) return;
    if (
      node.type.name === 'heading' &&
      Number(node.attrs.level ?? 1) >= 2 &&
      headingKey(node.textContent) === key
    ) {
      found = offset;
    }
  });
  return found;
}

/**
 * Where the section that starts at the heading at `headingPos` ends: the start of the next
 * heading of the same level or higher, or the end of the document.
 */
export function sectionEnd(doc: PmNode, headingPos: number): number {
  const heading = doc.nodeAt(headingPos);
  const level = Number(heading?.attrs.level ?? 2);
  let end = doc.content.size;
  let seen = false;
  doc.forEach((node, offset) => {
    if (seen || offset <= headingPos) return;
    if (node.type.name === 'heading' && Number(node.attrs.level ?? 1) <= level) {
      end = offset;
      seen = true;
    }
  });
  return end;
}

/**
 * Where "Add heading here" puts a heading for a cursor at `pos`: after the top-level block the
 * cursor is in, or in place of it when that block is an empty paragraph. Never inside a block,
 * so a sentence is never split by a heading.
 */
export function headingSlot(doc: PmNode, pos: number): { from: number; to: number } {
  const clamped = Math.max(0, Math.min(pos, doc.content.size));
  let slot: { from: number; to: number } | null = null;
  doc.forEach((node, offset) => {
    const end = offset + node.nodeSize;
    if (slot || clamped < offset || clamped > end) return;
    const empty = node.type.name === 'paragraph' && node.content.size === 0;
    slot = empty ? { from: offset, to: end } : { from: end, to: end };
  });
  return slot ?? { from: doc.content.size, to: doc.content.size };
}
