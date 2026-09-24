/**
 * Draws a chart onto a canvas — ADR-0027.
 *
 * Hand-drawn rather than a charting library, because the chart has to be the same every time
 * it is drawn from the same numbers, print in black and white, and carry nothing the student did
 * not type. A library brings animation, tooltips and a theme; a thesis figure needs axes, ticks,
 * bars or lines, a legend and the words. Everything is sized from the canvas width, so the same
 * spec drawn at 1600 px for print and at 480 px for a preview looks the same.
 */

import type { ChartSpec } from '@tc/types';
import { formatTick, niceTicks } from './scale.js';

/**
 * Colours that stay distinct in greyscale — each is a different lightness — for the thesis that
 * is printed on a departmental laser printer.
 */
export const CHART_PALETTE = [
  '#1f4e79',
  '#c55a11',
  '#548235',
  '#7030a0',
  '#bf9000',
  '#5b9bd5',
  '#7f7f7f',
  '#000000',
] as const;

const INK = '#111111';
const GRID = '#d9d9d9';
const FONT = '"Source Sans 3", "Segoe UI", system-ui, sans-serif';

type Ctx = CanvasRenderingContext2D;

export function drawChart(canvas: HTMLCanvasElement, spec: ChartSpec): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  const u = W / 100; // one per cent of the width: every size below is in these

  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = INK;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, u * 0.12);
  ctx.textBaseline = 'middle';

  const font = (size: number, weight = 400) => `${weight} ${Math.round(size)}px ${FONT}`;
  const titleSize = u * 2.2;
  const labelSize = u * 1.7;
  const tickSize = u * 1.5;

  // --- Scales -----------------------------------------------------------------------------
  const values = spec.series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  let min = Math.min(...values);
  let max = Math.max(...values);
  // Bars grow from zero; a line chart of positive numbers also starts there, because an axis
  // that starts at 40 makes a 5% change look like a collapse.
  if (spec.type === 'bar' || min > 0) min = Math.min(0, min);
  if (max < 0) max = 0;
  const ticks = niceTicks(min, max, 6);
  const yMin = ticks[0] ?? 0;
  const yMax = ticks[ticks.length - 1] ?? 1;

  // --- Layout -----------------------------------------------------------------------------
  const legend = spec.series.length > 1;
  const top = u * 2 + (spec.title ? titleSize * 1.8 : 0) + (legend ? labelSize * 1.8 : 0);
  ctx.font = font(tickSize);
  const tickWidth = Math.max(...ticks.map((t) => ctx.measureText(formatTick(t)).width));
  const left = u * 2 + (spec.yLabel ? labelSize * 1.6 : 0) + tickWidth + u * 1.2;
  const right = W - u * 3;

  // Category labels turn diagonal when they would overlap laid flat.
  const n = spec.categories.length;
  const slot = (right - left) / n;
  const widest = Math.max(...spec.categories.map((c) => ctx.measureText(c).width));
  const rotate = widest > slot * 0.9;
  const catHeight = rotate ? Math.min(widest, u * 22) * Math.SQRT1_2 + tickSize : tickSize * 1.4;
  const bottom = H - u * 2 - (spec.xLabel ? labelSize * 1.6 : 0) - catHeight;

  const y = (v: number) => bottom - ((v - yMin) / (yMax - yMin || 1)) * (bottom - top);
  const xCentre = (i: number) => left + slot * (i + 0.5);

  // --- Title and axis labels ---------------------------------------------------------------
  ctx.textAlign = 'center';
  if (spec.title) {
    ctx.font = font(titleSize, 600);
    ctx.fillText(spec.title, (left + right) / 2, u * 2 + titleSize / 2);
  }
  if (spec.xLabel) {
    ctx.font = font(labelSize);
    ctx.fillText(spec.xLabel, (left + right) / 2, H - u * 2 - labelSize / 2);
  }
  if (spec.yLabel) {
    ctx.save();
    ctx.translate(u * 2 + labelSize / 2, (top + bottom) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.font = font(labelSize);
    ctx.fillText(spec.yLabel, 0, 0);
    ctx.restore();
  }

  // --- Grid, axes, ticks -------------------------------------------------------------------
  ctx.font = font(tickSize);
  for (const t of ticks) {
    const ty = y(t);
    ctx.strokeStyle = GRID;
    line(ctx, left, ty, right, ty);
    ctx.fillStyle = INK;
    ctx.textAlign = 'right';
    ctx.fillText(formatTick(t), left - u * 0.8, ty);
  }
  ctx.strokeStyle = INK;
  line(ctx, left, top, left, bottom);
  line(ctx, left, y(0), right, y(0));

  ctx.textAlign = rotate ? 'right' : 'center';
  spec.categories.forEach((c, i) => {
    const cx = xCentre(i);
    const cy = bottom + tickSize * 0.9;
    if (rotate) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-Math.PI / 4);
      ctx.fillText(truncate(ctx, c, u * 22), 0, 0);
      ctx.restore();
    } else {
      ctx.fillText(truncate(ctx, c, slot * 0.95), cx, cy);
    }
  });

  // --- The data ----------------------------------------------------------------------------
  const colour = (s: number) => CHART_PALETTE[s % CHART_PALETTE.length] ?? INK;
  if (spec.type === 'bar') {
    // Bars fill most of their slot, but two categories do not become two slabs a page wide.
    const groupWidth = Math.min(slot * 0.7, (right - left) * 0.22);
    const barWidth = groupWidth / spec.series.length;
    spec.series.forEach((series, s) => {
      ctx.fillStyle = colour(s);
      series.values.forEach((v, i) => {
        if (v === null) return;
        const x0 = xCentre(i) - groupWidth / 2 + s * barWidth;
        const y0 = y(v);
        const yZero = y(0);
        ctx.fillRect(x0, Math.min(y0, yZero), barWidth * 0.92, Math.abs(yZero - y0));
      });
    });
  } else {
    ctx.lineWidth = Math.max(1.5, u * 0.25);
    ctx.lineJoin = 'round';
    spec.series.forEach((series, s) => {
      ctx.strokeStyle = colour(s);
      ctx.fillStyle = colour(s);
      let pen = false;
      ctx.beginPath();
      series.values.forEach((v, i) => {
        if (v === null) {
          pen = false; // a gap in the data is a gap in the line
          return;
        }
        if (pen) ctx.lineTo(xCentre(i), y(v));
        else ctx.moveTo(xCentre(i), y(v));
        pen = true;
      });
      ctx.stroke();
      series.values.forEach((v, i) => {
        if (v === null) return;
        ctx.beginPath();
        ctx.arc(xCentre(i), y(v), u * 0.45, 0, Math.PI * 2);
        ctx.fill();
      });
    });
  }

  // --- Legend --------------------------------------------------------------------------------
  if (legend) {
    ctx.font = font(labelSize * 0.9);
    ctx.textAlign = 'left';
    const swatch = labelSize * 0.8;
    const gap = u * 2.5;
    const widths = spec.series.map((s) => swatch * 1.5 + ctx.measureText(s.name).width);
    const total = widths.reduce((a, b) => a + b, 0) + gap * (spec.series.length - 1);
    let x = Math.max(left, (left + right) / 2 - total / 2);
    const ly = top - labelSize;
    spec.series.forEach((series, s) => {
      ctx.fillStyle = colour(s);
      if (spec.type === 'bar') ctx.fillRect(x, ly - swatch / 2, swatch, swatch);
      else {
        ctx.strokeStyle = colour(s);
        ctx.lineWidth = Math.max(1.5, u * 0.25);
        line(ctx, x, ly, x + swatch, ly);
      }
      ctx.fillStyle = INK;
      ctx.fillText(series.name, x + swatch * 1.5, ly);
      x += (widths[s] ?? 0) + gap;
    });
  }
  ctx.restore();
}

function line(ctx: Ctx, x1: number, y1: number, x2: number, y2: number): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function truncate(ctx: Ctx, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1);
  return `${cut}…`;
}
