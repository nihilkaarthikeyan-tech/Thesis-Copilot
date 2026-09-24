'use client';

/**
 * A chart from the student's own numbers — ADR-0027.
 *
 * The student types (or brings from a table) the categories and the values, chooses bar or line,
 * writes the title and the axis labels, and sees the chart as it will print. Insert draws it at
 * print size, uploads the picture as an ordinary figure, and keeps the numbers on the figure so it
 * can be opened and changed again.
 *
 * No model is involved anywhere in this: the chart is a deterministic drawing of what was typed.
 * There is nothing here that could invent a number, and nothing that could "improve" one.
 */

import { CHART_LIMITS, type ChartSpec, chartSpecSchema } from '@tc/types';
import { drawChart } from '@tc/ui';
import { useEffect, useMemo, useRef, useState } from 'react';

/** Print size: fits the text column at 300 dpi and stays under a megabyte as a PNG. */
const RENDER_WIDTH = 1600;
const RENDER_HEIGHT = 1000;

type Grid = {
  type: ChartSpec['type'];
  title: string;
  xLabel: string;
  yLabel: string;
  seriesNames: string[];
  rows: Array<{ category: string; cells: string[] }>;
};

function gridFrom(spec: ChartSpec | null): Grid {
  if (!spec) {
    return {
      type: 'bar',
      title: '',
      xLabel: '',
      yLabel: '',
      seriesNames: ['Value'],
      rows: [
        { category: '', cells: [''] },
        { category: '', cells: [''] },
        { category: '', cells: [''] },
      ],
    };
  }
  return {
    type: spec.type,
    title: spec.title,
    xLabel: spec.xLabel,
    yLabel: spec.yLabel,
    seriesNames: spec.series.map((s) => s.name),
    rows: spec.categories.map((category, i) => ({
      category,
      cells: spec.series.map((s) => {
        const v = s.values[i];
        return v === null || v === undefined ? '' : String(v);
      }),
    })),
  };
}

/** A typed cell as a number, or a gap. Same reading as a table cell (`parseCell`). */
function cellValue(text: string): number | null {
  const cleaned = text.replace(/[,\s%]/g, '').replace(/[−–]/, '-');
  if (cleaned === '' || cleaned === '-') return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : Number.NaN;
}

function specFrom(grid: Grid): { spec: ChartSpec | null; problem: string | null } {
  // Rows with neither a category nor a value are the spare lines of the grid, not data.
  const rows = grid.rows.filter((r) => r.category.trim() || r.cells.some((c) => c.trim()));
  if (rows.length === 0) return { spec: null, problem: 'Type some numbers to plot.' };
  for (const row of rows) {
    for (const cell of row.cells) {
      if (Number.isNaN(cellValue(cell))) {
        return { spec: null, problem: `“${cell}” is not a number.` };
      }
    }
  }
  const candidate = {
    type: grid.type,
    title: grid.title.trim(),
    xLabel: grid.xLabel.trim(),
    yLabel: grid.yLabel.trim(),
    categories: rows.map((r, i) => r.category.trim() || String(i + 1)),
    series: grid.seriesNames.map((name, s) => ({
      name: name.trim() || `Series ${s + 1}`,
      values: rows.map((r) => cellValue(r.cells[s] ?? '')),
    })),
  };
  const parsed = chartSpecSchema.safeParse(candidate);
  if (!parsed.success) {
    return { spec: null, problem: parsed.error.issues[0]?.message ?? 'That cannot be drawn.' };
  }
  return { spec: parsed.data, problem: null };
}

export function ChartDialog({
  open,
  initial,
  replacing,
  onClose,
  onInsert,
}: {
  open: boolean;
  /** The chart being edited, or the numbers a table offered, or nothing. */
  initial: ChartSpec | null;
  /** True when an existing chart is being changed rather than a new one inserted. */
  replacing: boolean;
  onClose: () => void;
  onInsert: (spec: ChartSpec, png: Blob) => Promise<void>;
}) {
  const [grid, setGrid] = useState<Grid>(() => gridFrom(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // A new opening is a new chart.
  useEffect(() => {
    if (open) {
      setGrid(gridFrom(initial));
      setError(null);
      titleRef.current?.focus();
    }
  }, [open, initial]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const { spec, problem } = useMemo(() => specFrom(grid), [grid]);

  useEffect(() => {
    const canvas = preview.current;
    if (!canvas) return;
    if (spec) drawChart(canvas, spec);
    else {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, [spec]);

  const update = (patch: Partial<Grid>) => setGrid((g) => ({ ...g, ...patch }));
  const setCell = (r: number, s: number, value: string) =>
    setGrid((g) => ({
      ...g,
      rows: g.rows.map((row, i) =>
        i === r ? { ...row, cells: row.cells.map((c, j) => (j === s ? value : c)) } : row,
      ),
    }));
  const setCategory = (r: number, value: string) =>
    setGrid((g) => ({
      ...g,
      rows: g.rows.map((row, i) => (i === r ? { ...row, category: value } : row)),
    }));
  const addRow = () =>
    setGrid((g) => ({
      ...g,
      rows: [...g.rows, { category: '', cells: g.seriesNames.map(() => '') }],
    }));
  const removeRow = (r: number) =>
    setGrid((g) => ({ ...g, rows: g.rows.filter((_, i) => i !== r) }));
  const addSeries = () =>
    setGrid((g) => ({
      ...g,
      seriesNames: [...g.seriesNames, ''],
      rows: g.rows.map((row) => ({ ...row, cells: [...row.cells, ''] })),
    }));
  const removeSeries = (s: number) =>
    setGrid((g) => ({
      ...g,
      seriesNames: g.seriesNames.filter((_, j) => j !== s),
      rows: g.rows.map((row) => ({ ...row, cells: row.cells.filter((_, j) => j !== s) })),
    }));

  async function insert() {
    if (!spec) return;
    setBusy(true);
    setError(null);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = RENDER_WIDTH;
      canvas.height = RENDER_HEIGHT;
      drawChart(canvas, spec);
      const png = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('no image'))),
          'image/png',
        ),
      );
      await onInsert(spec, png);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The chart could not be added.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  const field = 'w-full rounded-md border border-line-strong bg-paper px-2 py-1 text-sm text-ink';
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-ink/30 p-4 pt-10 sm:p-6 sm:pt-14">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="chart-title"
        data-testid="chart-dialog"
        className="max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-md border border-line bg-surface p-5 text-sm shadow-lg"
      >
        <div className="flex items-baseline justify-between">
          <h2 id="chart-title" className="font-serif text-lg">
            {replacing ? 'Edit chart' : 'Insert a chart'}
          </h2>
          <button type="button" className="text-xs text-muted underline" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="mt-1 text-xs text-muted">
          Drawn from the numbers you type, exactly as typed. It is added as a figure; the numbers
          stay with it so you can change them later.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr]">
          <div className="space-y-2">
            <div className="flex gap-3 text-xs">
              {(['bar', 'line'] as const).map((t) => (
                <label key={t} className="flex items-center gap-1">
                  <input
                    type="radio"
                    name="chart-type"
                    value={t}
                    checked={grid.type === t}
                    onChange={() => update({ type: t })}
                  />
                  {t === 'bar' ? 'Bar chart' : 'Line chart'}
                </label>
              ))}
            </div>
            <label className="block text-xs text-muted">
              Title
              <input
                ref={titleRef}
                className={field}
                maxLength={CHART_LIMITS.title}
                value={grid.title}
                data-testid="chart-title-input"
                onChange={(e) => update({ title: e.target.value })}
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs text-muted">
                X-axis label
                <input
                  className={field}
                  maxLength={CHART_LIMITS.label}
                  value={grid.xLabel}
                  onChange={(e) => update({ xLabel: e.target.value })}
                />
              </label>
              <label className="block text-xs text-muted">
                Y-axis label
                <input
                  className={field}
                  maxLength={CHART_LIMITS.label}
                  value={grid.yLabel}
                  onChange={(e) => update({ yLabel: e.target.value })}
                />
              </label>
            </div>
          </div>
          <div>
            <canvas
              ref={preview}
              width={640}
              height={400}
              data-testid="chart-preview"
              aria-label="Chart preview"
              className="w-full rounded-md border border-line bg-white"
            />
          </div>
        </div>

        <table className="mt-3 w-full border-collapse text-xs" data-testid="chart-grid">
          <thead>
            <tr>
              <th className="p-1 text-left font-normal text-muted">Category</th>
              {grid.seriesNames.map((name, s) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
                <th key={s} className="p-1">
                  <div className="flex items-center gap-1">
                    <input
                      className={field}
                      placeholder={`Series ${s + 1}`}
                      maxLength={CHART_LIMITS.label}
                      value={name}
                      aria-label={`Series ${s + 1} name`}
                      onChange={(e) =>
                        update({
                          seriesNames: grid.seriesNames.map((n, j) =>
                            j === s ? e.target.value : n,
                          ),
                        })
                      }
                    />
                    {grid.seriesNames.length > 1 ? (
                      <button
                        type="button"
                        aria-label={`Remove series ${s + 1}`}
                        className="text-muted hover:text-ink"
                        onClick={() => removeSeries(s)}
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row, r) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
              <tr key={r}>
                <td className="p-1">
                  <input
                    className={field}
                    placeholder={`Category ${r + 1}`}
                    maxLength={CHART_LIMITS.label}
                    value={row.category}
                    aria-label={`Category ${r + 1}`}
                    onChange={(e) => setCategory(r, e.target.value)}
                  />
                </td>
                {row.cells.map((cell, s) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional
                  <td key={s} className="p-1">
                    <input
                      className={`${field} text-right`}
                      inputMode="decimal"
                      value={cell}
                      aria-label={`Row ${r + 1}, series ${s + 1}`}
                      onChange={(e) => setCell(r, s, e.target.value)}
                    />
                  </td>
                ))}
                <td className="p-1">
                  {grid.rows.length > 1 ? (
                    <button
                      type="button"
                      aria-label={`Remove row ${r + 1}`}
                      className="text-muted hover:text-ink"
                      onClick={() => removeRow(r)}
                    >
                      ×
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2 flex gap-3 text-xs">
          <button
            type="button"
            className="underline disabled:opacity-50"
            disabled={grid.rows.length >= CHART_LIMITS.categories}
            onClick={addRow}
          >
            Add a row
          </button>
          <button
            type="button"
            className="underline disabled:opacity-50"
            disabled={grid.seriesNames.length >= CHART_LIMITS.series}
            onClick={addSeries}
          >
            Add a series
          </button>
        </div>

        {problem || error ? (
          <p role="alert" className="mt-2 text-xs text-warn">
            {error ?? problem}
          </p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-line-strong px-3 py-1.5 text-xs"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="chart-insert"
            disabled={!spec || busy}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink transition-colors hover:bg-accent-hover disabled:opacity-50"
            onClick={() => void insert()}
          >
            {busy ? 'Adding…' : replacing ? 'Update chart' : 'Insert chart'}
          </button>
        </div>
      </section>
    </div>
  );
}
