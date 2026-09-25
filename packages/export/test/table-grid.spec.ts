/**
 * Merged table cells in every export (2026-09-25). A merged cell appears once in the editor's
 * document; each exporter has to put every other cell back in its own column.
 */

import { describe, expect, it } from 'vitest';
import { gridOf, ruleUnder, spanOf } from '../src/table-grid.js';

const cell = (text: string, attrs: Record<string, unknown> = {}) => ({
  type: 'tableCell',
  attrs,
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
const row = (...cells: ReturnType<typeof cell>[]) => ({ type: 'tableRow', content: cells });

describe('the grid a merged table sits on', () => {
  it('puts a tall cell’s neighbours in their own columns in the rows below', () => {
    // | A (2 rows) | B |
    // |            | C |
    const grid = gridOf({
      type: 'table',
      content: [row(cell('A', { rowspan: 2 }), cell('B')), row(cell('C'))],
    });
    expect(grid.columns).toBe(2);
    expect(grid.rows[1]?.map((s) => s.kind)).toEqual(['below', 'cell']);
    expect(ruleUnder(grid, 0)).toBe('\\cline{2-2}');
    expect(ruleUnder(grid, 1)).toBe('\\hline');
  });

  it('reserves a wide cell’s columns in its row', () => {
    const grid = gridOf({
      type: 'table',
      content: [row(cell('Wide', { colspan: 2 })), row(cell('x'), cell('y'))],
    });
    expect(grid.rows[0]?.map((s) => s.kind)).toEqual(['cell', 'right']);
    expect(grid.columns).toBe(2);
  });

  it('cuts a rowspan that reaches past the last row, and pads a short row', () => {
    const grid = gridOf({
      type: 'table',
      content: [row(cell('A', { rowspan: 9 }), cell('B'), cell('C')), row(cell('D'))],
    });
    expect(grid.rows).toHaveLength(2);
    expect(grid.rows[1]?.map((s) => s.kind)).toEqual(['below', 'cell', 'empty']);
  });

  it('reads nonsense spans as one', () => {
    expect(spanOf({ attrs: { colspan: 'x', rowspan: -2 } })).toEqual({ colspan: 1, rowspan: 1 });
    expect(spanOf({ attrs: { colspan: 999 } }).colspan).toBe(50);
  });
});
