/**
 * A Markdown pipe table from the "As a table" edit action (ADR-0081) as a real table node, each
 * cell built by the same fragment builder a rewrite uses, so the citation markers the model kept
 * become citation nodes and the student's existing ones stay as they were.
 */

import type { AiTextOptions } from '@tc/ui';
import { aiTextToFragment } from '@tc/ui';
import type { Node as PmNode, Schema } from '@tiptap/pm/model';

export type MarkdownTable = { header: string[]; rows: string[][] };

/** The table's cells, or null when the text is not a pipe table with a header and a rule. */
export function parseMarkdownTable(text: string): MarkdownTable | null {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('|'));
  if (lines.length < 2) return null;
  const cells = (line: string) =>
    line
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());
  const header = cells(lines[0] as string);
  if (!/^\|?\s*:?-{2,}/.test(lines[1] as string)) return null;
  const rows = lines
    .slice(2)
    .map(cells)
    .filter((r) => r.some((c) => c.length > 0))
    .map((r) =>
      [...r, ...Array(Math.max(0, header.length - r.length)).fill('')].slice(0, header.length),
    );
  if (header.length === 0 || rows.length === 0) return null;
  return { header, rows };
}

/** The table node, or null when the schema has no table or the text is not one. */
export function tableNodeFromMarkdown(
  schema: Schema,
  text: string,
  options: AiTextOptions,
): PmNode | null {
  const parsed = parseMarkdownTable(text);
  const { table, tableRow, tableCell, tableHeader, paragraph } = schema.nodes;
  if (!parsed || !table || !tableRow || !tableCell || !tableHeader || !paragraph) return null;
  const cell = (type: typeof tableCell, content: string) => {
    const fragment = aiTextToFragment(schema, content.replace(/—/g, '—'), options);
    return type.createChecked(null, paragraph.createChecked(null, fragment));
  };
  const head = tableRow.createChecked(
    null,
    parsed.header.map((h) => cell(tableHeader, h)),
  );
  const body = parsed.rows.map((r) =>
    tableRow.createChecked(
      null,
      r.map((c) => cell(tableCell, c)),
    ),
  );
  return table.createChecked(null, [head, ...body]);
}
