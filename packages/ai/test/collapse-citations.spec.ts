/**
 * Adjacent citations to one source — 2026-10-04. A live suggestion ended
 * "(Jimenez 2021) (Jimenez 2021) (Jimenez 2021)": three passages of one paper, cited side by side.
 */

import { describe, expect, it } from 'vitest';
import { collapseSameSourceRuns, postProcessAssist } from '../src/builder/postprocess.js';

describe('collapseSameSourceRuns', () => {
  it('keeps one marker per source in a run of adjacent markers', () => {
    expect(collapseSameSourceRuns('growth {{cite:S1#c1}} {{cite:S1#c2}}{{cite:S1#c3}}.')).toBe(
      'growth {{cite:S1#c1}}.',
    );
  });

  it('keeps markers for different sources in the same run', () => {
    expect(collapseSameSourceRuns('x {{cite:S1#c1}}; {{cite:S2#c1}} {{cite:S1#c4}}.')).toBe(
      'x {{cite:S1#c1}}{{cite:S2#c1}}.',
    );
  });

  it('leaves the same source cited again later in the text alone', () => {
    const text = 'One {{cite:S1#c1}}. Two {{cite:S1#c2}}.';
    expect(collapseSameSourceRuns(text)).toBe(text);
  });

  it('leaves a single marker alone', () => {
    expect(collapseSameSourceRuns('x {{cite:S3#c2}}.')).toBe('x {{cite:S3#c2}}.');
  });
});

describe('in the A.1 pipeline', () => {
  it('reports only the kept citation as cited', () => {
    const result = postProcessAssist({
      output:
        'Restored sites hold less carbon than mature forests {{cite:S1#c1}} {{cite:S1#c2}} {{cite:S1#c3}}.',
      passageIds: ['S1#c1', 'S1#c2', 'S1#c3'],
      before: 'Mangrove restoration has expanded since the 1990s. ',
    });
    expect(result.text).toBe('Restored sites hold less carbon than mature forests {{cite:S1#c1}}.');
    expect(result.cited).toEqual(['S1#c1']);
    expect(result.hallucinated).toEqual([]);
  });
});
