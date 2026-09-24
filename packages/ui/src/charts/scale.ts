/**
 * The arithmetic under a chart, kept apart from the drawing so it can be tested without a canvas.
 */

/**
 * Round tick values covering [min, max] — the "nice numbers" rule every plotting library uses: a
 * step of 1, 2 or 5 times a power of ten, about `count` of them, the ends widened to fall on one.
 */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) {
    if (min === 0) return [0, 1];
    const pad = Math.abs(min) / 2;
    return niceTicks(min - pad, max + pad, count);
  }
  const span = niceNumber(max - min, false);
  const step = niceNumber(span / Math.max(1, count - 1), true);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  // Rounded to the step's own precision so 0.30000000000000004 prints as 0.3.
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(decimals)));
  return ticks;
}

function niceNumber(range: number, round: boolean): number {
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / 10 ** exponent;
  let nice: number;
  if (round) {
    nice = fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10;
  } else {
    nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  }
  return nice * 10 ** exponent;
}

/** A tick label: no trailing zeros, thousands separated, as an axis reads. */
export function formatTick(value: number): string {
  if (Math.abs(value) >= 1e6 || (value !== 0 && Math.abs(value) < 1e-4)) {
    return value.toExponential(1).replace('e+', 'e');
  }
  return value.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

/** A number as a student types one in a table: "1,250", "12.5%", " 40 ", "—" (nothing). */
export function parseCell(text: string): number | null {
  const cleaned = text
    .replace(/[,\s%₹$€£]/g, '')
    .replace(/^\((.*)\)$/, '-$1')
    .replace(/[−–]/, '-');
  if (cleaned === '' || cleaned === '-') return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

export type ChartInput = {
  xLabel: string;
  categories: string[];
  series: Array<{ name: string; values: Array<number | null> }>;
};

/**
 * A table as chart data: the first row names the series (its first cell is the x-axis label),
 * the first column names the categories, and the rest are the values. Null when the table has no
 * numbers in it — the dialog then opens empty rather than with a chart of nothing.
 */
export function tableToChartInput(rows: readonly (readonly string[])[]): ChartInput | null {
  const [header, ...body] = rows;
  if (!header || header.length < 2 || body.length === 0) return null;
  const width = Math.max(...rows.map((r) => r.length));
  const cell = (row: readonly string[], i: number) => (row[i] ?? '').trim();
  const series = Array.from({ length: width - 1 }, (_, s) => ({
    name: cell(header, s + 1) || `Series ${s + 1}`,
    values: body.map((row) => parseCell(cell(row, s + 1))),
  })).filter((s) => s.values.some((v) => v !== null));
  if (series.length === 0) return null;
  return {
    xLabel: cell(header, 0),
    categories: body.map((row, i) => cell(row, 0) || String(i + 1)),
    series,
  };
}
