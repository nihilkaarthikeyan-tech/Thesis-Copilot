/**
 * The cells of the table the cursor is in, as text — so a chart can start from a table the
 * student has already typed rather than being typed a second time.
 */

import type { Editor } from '@tiptap/core';
import { findParentNode } from '@tiptap/core';

export function tableRowsAt(editor: Editor): string[][] | null {
  const found = findParentNode((node) => node.type.name === 'table')(editor.state.selection);
  if (!found) return null;
  const rows: string[][] = [];
  found.node.forEach((row) => {
    const cells: string[] = [];
    row.forEach((cell) => {
      cells.push(cell.textContent.trim());
    });
    rows.push(cells);
  });
  return rows;
}
