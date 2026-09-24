/**
 * The arithmetic under a chart (ADR-0027). The drawing itself is proven in a browser
 * (`apps/web/e2e/charts.spec.ts`); these are the parts a wrong number would come from.
 */

import { describe, expect, it } from 'vitest';
import { formatTick, niceTicks, parseCell, tableToChartInput } from '../src/charts/scale.js';

describe('ticks', () => {
  it('fall on round numbers and cover the data', () => {
    expect(niceTicks(0, 47)).toEqual([0, 10, 20, 30, 40, 50]);
    expect(niceTicks(0, 1)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(niceTicks(12, 88)).toEqual([0, 20, 40, 60, 80, 100]);
  });

  it('handle negatives and a single value', () => {
    expect(niceTicks(-15, 30)[0]).toBeLessThanOrEqual(-15);
    expect(niceTicks(-15, 30)).toContain(0);
    expect(niceTicks(5, 5).length).toBeGreaterThan(1);
    expect(niceTicks(0, 0)).toEqual([0, 1]);
  });

  it('print without floating-point noise', () => {
    for (const t of niceTicks(0, 0.7)) expect(String(t)).not.toMatch(/0000|9999/);
    expect(formatTick(1250)).toBe('1,250');
    expect(formatTick(0.5)).toBe('0.5');
    expect(formatTick(2_500_000)).toBe('2.5e6');
  });
});

describe('numbers as a student types them', () => {
  it('reads separators, signs and units, and nothing as a gap', () => {
    expect(parseCell('1,250')).toBe(1250);
    expect(parseCell(' 12.5% ')).toBe(12.5);
    expect(parseCell('₹ 3,40,000')).toBe(340000);
    expect(parseCell('(42)')).toBe(-42);
    expect(parseCell('−7')).toBe(-7);
    expect(parseCell('')).toBeNull();
    expect(parseCell('—')).toBeNull();
    expect(parseCell('n/a')).toBeNull();
  });
});

describe('a table as chart data', () => {
  it('takes the first row as the series and the first column as the categories', () => {
    expect(
      tableToChartInput([
        ['District', '2019', '2020'],
        ['North', '12', '15'],
        ['South', '8', 'n/a'],
      ]),
    ).toEqual({
      xLabel: 'District',
      categories: ['North', 'South'],
      series: [
        { name: '2019', values: [12, 8] },
        { name: '2020', values: [15, null] },
      ],
    });
  });

  it('leaves out a column with no numbers, and is nothing when none has any', () => {
    const input = tableToChartInput([
      ['Site', 'Notes', 'Yield'],
      ['A', 'dry', '4.1'],
      ['B', 'wet', '5.0'],
    ]);
    expect(input?.series.map((s) => s.name)).toEqual(['Yield']);
    expect(
      tableToChartInput([
        ['Site', 'Notes'],
        ['A', 'dry'],
      ]),
    ).toBeNull();
    expect(tableToChartInput([['Only a header']])).toBeNull();
  });

  it('numbers an unnamed category and series rather than dropping them', () => {
    const input = tableToChartInput([
      ['', ''],
      ['', '3'],
    ]);
    expect(input?.categories).toEqual(['1']);
    expect(input?.series[0]?.name).toBe('Series 1');
  });
});
