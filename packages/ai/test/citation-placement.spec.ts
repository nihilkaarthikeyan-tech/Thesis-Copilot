/**
 * Where a citation marker sits (ADR-0150, from the side-by-side of 2026-10-10): a live
 * suggestion ended "…in Karnataka. {{cite:S1#c1}}", and another cited one paper in both of its
 * sentences. Both are fixed in code, after the model answers.
 */

import { describe, expect, it } from 'vitest';
import {
  dedupeCitationKeys,
  moveTrailingCitationsInside,
  placeCitations,
} from '../src/builder/citation-placement.js';
import { postProcessAssist } from '../src/builder/postprocess.js';

describe('moveTrailingCitationsInside', () => {
  it('moves a marker after the full stop to before it', () => {
    expect(moveTrailingCitationsInside('low in Karnataka. {{cite:S1#c1}}')).toBe(
      'low in Karnataka {{cite:S1#c1}}.',
    );
  });

  it('moves a run of markers, and keeps a closing quote with the sentence', () => {
    expect(moveTrailingCitationsInside('said "no." {{cite:S1#c1}} {{cite:S2#c1}} Next.')).toBe(
      'said "no {{cite:S1#c1}}{{cite:S2#c1}}". Next.',
    );
  });

  it('does it for each sentence of a two-sentence answer', () => {
    expect(
      moveTrailingCitationsInside('One is clear.{{cite:S1#c1}} Two is not. {{cite:S2#c1}}'),
    ).toBe('One is clear {{cite:S1#c1}}. Two is not {{cite:S2#c1}}.');
  });

  it('leaves a marker already inside the sentence alone', () => {
    const text = 'low in Karnataka {{cite:S1#c1}}. Next sentence {{cite:S2#c1}}.';
    expect(moveTrailingCitationsInside(text)).toBe(text);
  });

  it('leaves a marker that starts the next sentence alone', () => {
    const text = 'One. {{cite:S1#c1}} shows two.';
    expect(moveTrailingCitationsInside(text)).toBe(text);
  });
});

describe('dedupeCitationKeys', () => {
  it('keeps the later of two markers for one key', () => {
    expect(dedupeCitationKeys('Low uptake {{cite:S1#c1}}. Two kinds {{cite:S1#c1}}.')).toBe(
      'Low uptake. Two kinds {{cite:S1#c1}}.',
    );
  });

  it('treats two chunks of one paper as one citation', () => {
    expect(dedupeCitationKeys('Low uptake {{cite:S1#c1}}. Two kinds {{cite:S1#c2}}.')).toBe(
      'Low uptake. Two kinds {{cite:S1#c2}}.',
    );
  });

  it('keeps markers for different papers', () => {
    const text = 'Low uptake {{cite:S1#c1}}. Two kinds {{cite:S2#c1}}.';
    expect(dedupeCitationKeys(text)).toBe(text);
  });

  it('keeps one of each when two papers are each cited twice', () => {
    expect(
      dedupeCitationKeys('A {{cite:S1#c1}}{{cite:S2#c1}}. B {{cite:S1#c1}}{{cite:S2#c3}}.'),
    ).toBe('A. B {{cite:S1#c1}}{{cite:S2#c3}}.');
  });
});

describe('placeCitations', () => {
  it('moves first, then dedupes, so a moved marker can be the one kept', () => {
    expect(placeCitations('A {{cite:S1#c1}}. B. {{cite:S1#c1}}')).toBe('A. B {{cite:S1#c1}}.');
  });
});

describe('placeCitations through postProcessAssist', () => {
  it('a live answer: marker after the stop, then the same paper twice', () => {
    const result = postProcessAssist({
      output:
        'Uptake is low among rural households {{cite:S1#c1}}. Clarifying these barriers is crucial for policy. {{cite:S1#c1}}',
      passageIds: ['S1#c1'],
      before: 'Rooftop solar adoption remains low despite state subsidies.',
    });
    expect(result.text).toBe(
      'Uptake is low among rural households. Clarifying these barriers is crucial for policy {{cite:S1#c1}}.',
    );
    expect(result.cited).toEqual(['S1#c1']);
  });

  it('a marker moved inside the stop is still counted as cited', () => {
    const result = postProcessAssist({
      output: 'Uptake is low in these villages. {{cite:S2#c1}}',
      passageIds: ['S2#c1'],
      before: 'Subsidies exist.',
    });
    expect(result.text).toBe('Uptake is low in these villages {{cite:S2#c1}}.');
    expect(result.cited).toEqual(['S2#c1']);
  });
});
