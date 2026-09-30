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
  isUncitedAttribution,
  nearDuplicate,
  normalizeBareCitations,
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
    expect(result.drops).toEqual({ duplicate: 0, roadmap: 0, dangling: 0, unsupported: 0 });
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

describe('A.1 when no passage supports what comes next (approved 2026-09-30)', () => {
  it('offers nothing, is not charged, and names what is missing', () => {
    const result = postProcessAssist({
      output: '[[NEEDS SOURCE: electrode wear rates in Hastelloy EDM]]',
      passageIds: [],
      before: 'Electrode wear governs the cost of machining Hastelloy.',
    });
    expect(result.empty).toBe(true);
    expect(result.text).toBe('');
    expect(result.needsSource).toBe('electrode wear rates in Hastelloy EDM');
  });

  it('never shows the marker, even beside text', () => {
    const result = postProcessAssist({
      output: 'Copper electrodes wear fastest {{cite:S1}}. [[NEEDS SOURCE: graphite wear data]]',
      passageIds: ['S1'],
      before: 'Electrode choice matters.',
    });
    expect(result.text).not.toContain('NEEDS SOURCE');
    expect(result.text).toContain('Copper electrodes wear fastest');
    expect(result.needsSource).toBe('graphite wear data');
  });

  it('is null when the model wrote a suggestion', () => {
    expect(
      postProcessAssist({ output: 'A sentence.', passageIds: [], before: 'Before.' }).needsSource,
    ).toBeNull();
  });
});

describe('a claim credited to research with no citation (real model, 2026-09-30)', () => {
  it('drops what gpt-5-nano wrote on an empty library', () => {
    const result = postProcessAssist({
      output:
        'However, recent work shows that optimizing process parameters can mitigate electrode wear while maintaining material removal rates.',
      passageIds: [],
      before: 'Electrode wear remains a major cost in this process.',
    });
    expect(result.empty).toBe(true);
    expect(result.drops.unsupported).toBe(1);
  });

  it('keeps the same claim when it cites its source', () => {
    expect(
      isUncitedAttribution(
        'Recent work shows that pulse-on time drives electrode wear {{cite:S1}}.',
      ),
    ).toBe(false);
  });

  it('knows the common shapes, and leaves ordinary sentences alone', () => {
    for (const s of [
      'Studies have shown that copper electrodes wear fastest.',
      'It has been widely reported that graphite is cheaper to machine.',
      'According to previous research, tool wear rises with current.',
      'Several studies examined composite electrodes.',
    ]) {
      expect(isUncitedAttribution(s)).toBe(true);
    }
    for (const s of [
      'This thesis compares composite and conventional electrodes.',
      'Tool wear rate was measured by weight loss after each cut.',
      'The results show that wear rose with peak current.',
    ]) {
      expect(isUncitedAttribution(s)).toBe(false);
    }
  });
});

describe('abbreviations and bare citation ids (prompt evaluation, 2026-09-30)', () => {
  const ids = ['S1#c1', 'S3#c1', 'S6#c1'];

  it('does not end a sentence at "et al." or "e.g."', () => {
    expect(
      splitSentences(
        'Zhao et al. reported lower wear with graphite. Copper, e.g. in finishing, wore more.',
      ),
    ).toHaveLength(2);
    const result = postProcessAssist({
      output:
        'Graphite wore less than copper {{cite:S1#c1}}. Zhao et al. found the same at high current {{cite:S3#c1}}. A third sentence.',
      passageIds: ids,
      before: 'Electrode wear is one of the main concerns.',
    });
    expect(result.text).toContain('Zhao et al. found the same at high current {{cite:S3#c1}}.');
    expect(result.text).not.toContain('A third sentence');
  });

  it('turns a bare passage id into a citation, and still strips one not in the request', () => {
    expect(normalizeBareCitations('Wear fell by half (S3#c1; S1#c1).')).toBe(
      'Wear fell by half {{cite:S3#c1}}{{cite:S1#c1}}.',
    );
    expect(normalizeBareCitations('Agarwal et al. [S6#c1] reported it.')).toBe(
      'Agarwal et al. {{cite:S6#c1}} reported it.',
    );
    expect(normalizeBareCitations('Kept {{cite:S1#c1}} as is.')).toBe('Kept {{cite:S1#c1}} as is.');

    const result = postProcessAssist({
      output: 'Wear fell by half (S3#c1; S9#c4).',
      passageIds: ids,
      before: 'Electrode wear is one of the main concerns.',
    });
    expect(result.text).toBe('Wear fell by half {{cite:S3#c1}}.');
    expect(result.hallucinated).toEqual(['S9#c4']);
  });
});

describe('an answer that only repeats the student (prompt evaluation, 2026-09-30)', () => {
  it('is empty, not a row of bare citations', () => {
    const before = 'Heat treatment after printing changes the microstructure of these parts.';
    const result = postProcessAssist({
      output: `${before} {{cite:S3#c1}} {{cite:S4#c1}}`,
      passageIds: ['S3#c1', 'S4#c1'],
      before,
    });
    expect(result.text).toBe('');
    expect(result.empty).toBe(true);
    expect(result.cited).toEqual([]);
  });
});
