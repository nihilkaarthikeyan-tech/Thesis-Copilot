/**
 * A Markdown list from the "Bulleted list" or "Numbered list" edit (ADR-0095) as a real list node,
 * each item built by the same fragment builder a rewrite uses, so the citation markers the model
 * kept become citation nodes and the student's existing ones stay as they were.
 */

import type { AiTextOptions } from '@tc/ui';
import { aiTextToFragment } from '@tc/ui';
import type { Node as PmNode, Schema } from '@tiptap/pm/model';

export type MarkdownList = { ordered: boolean; items: string[] };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBER = /^\s*\d+[.)]\s+(.*)$/;

/** The list's items, or null when the text is not one list ("- " items, or "1. " items). */
export function parseMarkdownList(text: string): MarkdownList | null {
  const lines = text
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return null;
  const bullets = lines.map((l) => BULLET.exec(l)?.[1]);
  if (bullets.every((b) => b !== undefined)) {
    return { ordered: false, items: bullets.map((b) => (b as string).trim()) };
  }
  const numbers = lines.map((l) => NUMBER.exec(l)?.[1]);
  if (numbers.every((n) => n !== undefined)) {
    return { ordered: true, items: numbers.map((n) => (n as string).trim()) };
  }
  return null;
}

/** The list node, or null when the schema has no lists or the text is not one. */
export function listNodeFromMarkdown(
  schema: Schema,
  text: string,
  options: AiTextOptions,
): PmNode | null {
  const parsed = parseMarkdownList(text);
  const { bulletList, orderedList, listItem, paragraph } = schema.nodes;
  if (!parsed || !bulletList || !orderedList || !listItem || !paragraph) return null;
  const items = parsed.items.map((item) =>
    listItem.createChecked(
      null,
      paragraph.createChecked(null, aiTextToFragment(schema, item, options)),
    ),
  );
  return (parsed.ordered ? orderedList : bulletList).createChecked(null, items);
}
