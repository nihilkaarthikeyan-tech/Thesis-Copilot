/**
 * The quality filters (2026-09-30), tested on the paragraph a reviewer sent: a Literature Review
 * written here that repeated one sentence word for word, restated its roadmap three or four times
 * and opened a sentence with "Despite this" after nothing it could contrast with.
 */

import { describe, expect, it } from 'vitest';
import {
  filterDraftParagraphs,
  filterSentences,
  isRoadmap,
  nearDuplicate,
  postProcessAssist,
  splitSentences,
} from '../src/index.js';

/** The reviewer's sample, as the student's chapter held it (spaces restored). */
const REVIEWED_SAMPLE = [
  'This section will synthesize existing findings across sub-themes and identify where evidence is insufficient to support a direct comparison of composite versus conventional electrodes in Hastelloy EDM.',
  'This synthesis will be organized by sub-theme, drawing on prior work on electrode materials, wear mechanisms, and Hastelloy machining to delineate what is known and what remains unresolved.',
  'Despite this, there is no explicit comparative analysis for Hastelloy EDM that pits composite electrodes against conventional copper or graphitic options, a gap this thesis seeks to address.',
  'Despite this, there is no explicit comparative analysis for Hastelloy EDM that pits composite electrodes against conventional copper or graphitic options, a gap this thesis seeks to address.',
  'The following sub-themes organize the review and highlight where evidence supports or falls short of enabling a direct, systematic comparison for Hastelloy electrode wear.',
  'The synthesis will identify recurring wear modes and parameter sensitivities reported for different electrode classes, while noting discrepancies in Hastelloy-specific contexts.',
  'It will also articulate methodological limitations that hinder cross-study comparability, thereby framing the necessity for a controlled, direct comparison within this thesis.',
];

describe('what the reviewer saw would not be offered', () => {
  it('drops every roadmap sentence, the dangling "Despite this" and the repeat', () => {
    const { text, drops } = filterSentences({
      text: REVIEWED_SAMPLE.join(' '),
      before: '',
      existing: '',
    });
    expect(drops.roadmap).toBeGreaterThanOrEqual(4);
    expect(drops.dangling).toBeGreaterThanOrEqual(1);
    expect(text).not.toMatch(
      /will synthesize|will be organized|will identify|will also articulate/,
    );
    // The only claim in the sample survives at most once.
    expect(text.split('no explicit comparative analysis').length - 1).toBeLessThanOrEqual(1);
  });

  it('does not offer a sentence the chapter already contains', () => {
    const existing = REVIEWED_SAMPLE[2] as string;
    const result = postProcessAssist({
      output:
        'However, there is no explicit comparative analysis for Hastelloy EDM that pits composite electrodes against conventional copper or graphite options, a gap this thesis addresses.',
      passageIds: [],
      before: 'Copper electrodes wear fastest at high peak current {{cite:S1}}.',
      existingText: existing,
    });
    expect(result.empty).toBe(true);
    expect(result.drops.duplicate).toBe(1);
  });

  it('does not offer "this section will…" filler', () => {
    const result = postProcessAssist({
      output: 'This section will examine the wear of copper electrodes in Hastelloy machining.',
      passageIds: [],
      before: 'Electrode wear governs the cost of EDM.',
    });
    expect(result.empty).toBe(true);
    expect(result.drops.roadmap).toBe(1);
  });
});

describe('what a good suggestion keeps', () => {
  it('keeps a cited finding and a connective that follows a real claim', () => {
    const result = postProcessAssist({
      output:
        'However, graphite electrodes showed lower relative wear at long pulse durations {{cite:S2}}.',
      passageIds: ['S2'],
      before: 'Copper electrodes wear fastest at high peak current {{cite:S1}}.',
    });
    expect(result.empty).toBe(false);
    expect(result.text).toContain('graphite electrodes');
    expect(result.drops).toEqual({ duplicate: 0, roadmap: 0, dangling: 0 });
  });

  it('drops a connective that opens a paragraph, since there is nothing to contrast', () => {
    const { drops } = filterSentences({
      text: 'Furthermore, composite electrodes reduce tool wear in nickel alloys.',
      before: 'Chapter two.\n',
      existing: '',
    });
    expect(drops.dangling).toBe(1);
  });

  it('keeps a cited roadmap-looking sentence: a citation makes it a claim', () => {
    expect(isRoadmap('This review will follow the taxonomy of Ho and Newman {{cite:S3}}.')).toBe(
      false,
    );
  });

  it('keeps present-tense statements of what a chapter does', () => {
    expect(isRoadmap('This chapter reviews prior work on electrode wear in Hastelloy EDM.')).toBe(
      false,
    );
  });

  it('treats short sentences and different claims as different', () => {
    expect(nearDuplicate('Copper wears fast.', 'Copper wears fast.')).toBe(false);
    expect(
      nearDuplicate(
        'Copper electrodes wear fastest at high peak current in Inconel machining.',
        'Graphite electrodes show the lowest wear at long pulse durations in titanium.',
      ),
    ).toBe(false);
  });

  it('splits sentences without breaking a citation away from its sentence', () => {
    expect(splitSentences('One claim. {{cite:S1}} Two claims {{cite:S2}}.')).toEqual([
      'One claim. {{cite:S1}}',
      'Two claims {{cite:S2}}.',
    ]);
  });
});

describe('drafts', () => {
  it('removes roadmap paragraphs and repeats, and keeps headings and findings', () => {
    const markdown = [
      '### Electrode materials',
      'This section will review the electrode materials used in Hastelloy EDM.',
      'Copper-tungsten electrodes showed 40% lower wear than pure copper {{cite:S1}}.',
      'Copper-tungsten electrodes showed forty percent lower wear than pure copper {{cite:S1}}.',
      'However, graphite remains cheaper to machine into complex shapes {{cite:S2}}.',
    ].join('\n\n');
    const out = filterDraftParagraphs(markdown, '');
    expect(out).toContain('### Electrode materials');
    expect(out).not.toContain('This section will review');
    expect(out.match(/lower wear than pure copper/g)).toHaveLength(1);
    expect(out).toContain('However, graphite remains cheaper');
  });
});
