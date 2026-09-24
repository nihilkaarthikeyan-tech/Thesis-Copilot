import { describe, expect, it } from 'vitest';
import { chartSpecSchema } from '../src/chart.js';

const spec = {
  type: 'bar',
  title: 'Uptake by district',
  categories: ['North', 'South'],
  series: [{ name: '2020', values: [12, 8] }],
};

describe('a chart spec', () => {
  it('is the student’s numbers and words, and nothing else', () => {
    const parsed = chartSpecSchema.parse(spec);
    expect(parsed.xLabel).toBe('');
    expect(parsed.series[0]?.values).toEqual([12, 8]);
  });

  it('needs one value per category, and something to plot', () => {
    expect(
      chartSpecSchema.safeParse({ ...spec, series: [{ name: 'x', values: [1] }] }).success,
    ).toBe(false);
    expect(
      chartSpecSchema.safeParse({ ...spec, series: [{ name: 'x', values: [null, null] }] }).success,
    ).toBe(false);
  });

  it('allows a gap in a series, which is drawn as one', () => {
    expect(
      chartSpecSchema.safeParse({ ...spec, series: [{ name: 'x', values: [1, null] }] }).success,
    ).toBe(true);
  });

  it('refuses what a canvas cannot draw: a NaN, an empty axis, a third kind of chart', () => {
    expect(
      chartSpecSchema.safeParse({ ...spec, series: [{ name: 'x', values: [Number.NaN, 1] }] })
        .success,
    ).toBe(false);
    expect(chartSpecSchema.safeParse({ ...spec, categories: [] }).success).toBe(false);
    expect(chartSpecSchema.safeParse({ ...spec, type: 'pie' }).success).toBe(false);
  });
});
