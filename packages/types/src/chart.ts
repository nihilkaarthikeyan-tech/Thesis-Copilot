/**
 * A chart the student draws from their own numbers — ADR-0027.
 *
 * The spec is the whole chart: the type, the words on it, the categories along the x axis and one
 * or more series of values. It is drawn deterministically from this and nothing else (no model,
 * no invented numbers), stored on the figure so it can be edited again, and rendered to a PNG that
 * every exporter already handles as a figure.
 *
 * Two kinds only. A bar chart and a line chart cover what a thesis needs to show — counts by
 * group, a value over time — and a pie chart is what examiners ask students to replace.
 */

import { z } from 'zod';

export const CHART_TYPES = ['bar', 'line'] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export const CHART_LIMITS = {
  /** Series drawn on one chart; past this the legend stops being readable. */
  series: 8,
  /** Categories along the x axis. */
  categories: 100,
  label: 120,
  title: 200,
} as const;

const label = z.string().trim().max(CHART_LIMITS.label);

export const chartSpecSchema = z
  .object({
    type: z.enum(CHART_TYPES),
    title: z.string().trim().max(CHART_LIMITS.title),
    xLabel: label.default(''),
    yLabel: label.default(''),
    categories: z.array(label).min(1).max(CHART_LIMITS.categories),
    series: z
      .array(
        z.object({
          name: label,
          /** One value per category; null is a gap, not a zero. */
          values: z.array(z.number().finite().nullable()),
        }),
      )
      .min(1)
      .max(CHART_LIMITS.series),
  })
  .superRefine((spec, ctx) => {
    spec.series.forEach((series, i) => {
      if (series.values.length !== spec.categories.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['series', i, 'values'],
          message: `Series ${i + 1} has ${series.values.length} values for ${spec.categories.length} categories.`,
        });
      }
    });
    if (!spec.series.some((s) => s.values.some((v) => v !== null))) {
      ctx.addIssue({ code: 'custom', path: ['series'], message: 'There is nothing to plot.' });
    }
  });

export type ChartSpec = z.infer<typeof chartSpecSchema>;
