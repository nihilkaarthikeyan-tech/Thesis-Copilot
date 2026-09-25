/**
 * Merged table cells, for every exporter (2026-09-25).
 *
 * ProseMirror stores a table as HTML does: a merged cell appears once, with `colspan` and
 * `rowspan`, and the rows it reaches into simply have fewer cells. Word and HTML read that shape
 * directly. LaTeX does not — it needs every row to name every column, with `\multicolumn` for a
 * wide cell, `\multirow` plus empty placeholders for a tall one, and `\cline` rather than `\hline`
 * under a row a tall cell continues through. `gridOf` lays the table out on its real grid once so
 * the LaTeX writer can do that without guessing.
 *
 * Until the editor could merge cells, no exporter needed this; the moment it could, a merged
 * table would have come out of every exporter with its columns shifted.
 */

type Node = { type?: string; attrs?: Record<string, unknown>; content?: Node[] };

const MAX_SPAN = 50;

/** A cell's spans, clamped to something a document can hold. */
export function spanOf(cell: Node): { colspan: number; rowspan: number } {
  const read = (value: unknown) => {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isInteger(n) && n >= 1 ? Math.min(n, MAX_SPAN) : 1;
  };
  return { colspan: read(cell.attrs?.colspan), rowspan: read(cell.attrs?.rowspan) };
}

/** One slot of the grid: the cell that starts here, or a slot another cell covers. */
export type Slot =
  | { kind: 'cell'; cell: Node; colspan: number; rowspan: number }
  /** Covered by a cell from a row above; `lead` is the leftmost column of that cell. */
  | { kind: 'below'; lead: boolean; colspan: number }
  /** Covered by a cell to the left in the same row. */
  | { kind: 'right' }
  /** A row shorter than the table: nothing there at all. */
  | { kind: 'empty' };

export type Grid = {
  columns: number;
  rows: Slot[][];
  /** `continues[r][c]`: the cell covering (r, c) also covers (r + 1, c). */
  continues: boolean[][];
};

export function gridOf(table: Node): Grid {
  const rows = table.content ?? [];
  const occupied: Array<Array<Slot | undefined>> = rows.map(() => []);
  const continues: boolean[][] = rows.map(() => []);

  rows.forEach((row, r) => {
    let c = 0;
    for (const cell of row.content ?? []) {
      while (occupied[r]?.[c]) c++;
      const { colspan, rowspan: asked } = spanOf(cell);
      // A rowspan reaching past the last row is cut to the rows there are.
      const rowspan = Math.min(asked, rows.length - r);
      for (let dr = 0; dr < rowspan; dr++) {
        for (let dc = 0; dc < colspan; dc++) {
          const target = occupied[r + dr] as Array<Slot | undefined>;
          target[c + dc] =
            dr === 0 && dc === 0
              ? { kind: 'cell', cell, colspan, rowspan }
              : dr === 0
                ? { kind: 'right' }
                : { kind: 'below', lead: dc === 0, colspan };
          (continues[r + dr] as boolean[])[c + dc] = dr < rowspan - 1;
        }
      }
      c += colspan;
    }
  });

  const columns = Math.max(1, ...occupied.map((row) => row.length));
  return {
    columns,
    rows: occupied.map((row) =>
      Array.from({ length: columns }, (_, c) => row[c] ?? ({ kind: 'empty' } as const)),
    ),
    continues: continues.map((row) => Array.from({ length: columns }, (_, c) => row[c] ?? false)),
  };
}

/**
 * The rule under row `r`: `\hline` when no tall cell continues through it, otherwise one
 * `\cline{a-b}` per run of columns that do end here.
 */
export function ruleUnder(grid: Grid, r: number): string {
  const ends = grid.continues[r]?.map((goesOn) => !goesOn) ?? [];
  if (ends.every(Boolean)) return '\\hline';
  const runs: string[] = [];
  let start = -1;
  ends.forEach((end, c) => {
    if (end && start === -1) start = c;
    if ((!end || c === ends.length - 1) && start !== -1) {
      const stop = end ? c : c - 1;
      runs.push(`\\cline{${start + 1}-${stop + 1}}`);
      start = -1;
    }
  });
  return runs.join(' ');
}

/** The spans as `docx`'s `TableCell` takes them; it writes the continuation cells itself. */
export function docxSpans(cell: Node): { columnSpan?: number; rowSpan?: number } {
  const { colspan, rowspan } = spanOf(cell);
  return {
    ...(colspan > 1 ? { columnSpan: colspan } : {}),
    ...(rowspan > 1 ? { rowSpan: rowspan } : {}),
  };
}
