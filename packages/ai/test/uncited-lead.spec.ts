/**
 * ADR-0147 round 6, in code rather than in the prompt:
 *
 *   1. `dropUncitedLead`: a suggestion whose first sentence carries no citation while a later one
 *      does is offered without that first sentence, when what is left stands alone. No citation is
 *      added or moved (§10.6).
 *   2. `withheldOpening`: at an opening (an empty chapter or section), a passage that starts at its
 *      abstract's first sentence goes to the model without that sentence; id and reference stay.
 */

import { describe, expect, it } from 'vitest';
import {
  assistUserMessage,
  isOpening,
  type PromptPassage,
  withheldOpening,
} from '../src/builder/assist.js';
import { dropUncitedLead, postProcessAssist } from '../src/builder/postprocess.js';

const ENDS = 'Rural households in Karnataka have been slow to adopt rooftop solar.';
const LEAD = 'Rooftop systems need a large payment before any saving is seen.';
const CITED = 'Upfront cost was the barrier most households named {{cite:S1#c1}}.';

describe('dropUncitedLead', () => {
  it('drops an uncited first sentence before a cited one', () => {
    expect(dropUncitedLead(`${LEAD} ${CITED}`, ENDS)).toBe(CITED);
  });

  it('also after a heading, and in an empty chapter', () => {
    expect(dropUncitedLead(`${LEAD} ${CITED}`, 'Barriers to adoption\n')).toBe(CITED);
    expect(dropUncitedLead(`${LEAD} ${CITED}`, '')).toBe(CITED);
    expect(dropUncitedLead(`${LEAD} ${CITED}`, `${ENDS}\n`)).toBe(CITED);
  });

  it('keeps a cited first sentence, and a pair cited in both', () => {
    const both = `Subsidies cut the payback period to six years {{cite:S2#c1}}. ${CITED}`;
    expect(dropUncitedLead(both, ENDS)).toBe(both);
    const firstOnly = `Subsidies cut the payback period to six years {{cite:S2#c1}}. ${LEAD}`;
    expect(dropUncitedLead(firstOnly, ENDS)).toBe(firstOnly);
  });

  it('keeps a single sentence, cited or not (the behaviour before)', () => {
    expect(dropUncitedLead(LEAD, ENDS)).toBe(LEAD);
    expect(dropUncitedLead(CITED, ENDS)).toBe(CITED);
  });

  it('keeps a suggestion with no citation at all', () => {
    const none = `${LEAD} Upfront cost was the barrier most households named.`;
    expect(dropUncitedLead(none, ENDS)).toBe(none);
  });

  describe('a mid-sentence continuation is the student’s own sentence and is never dropped', () => {
    it.each([
      'Urban heat islands raise night-time temperatures because ',
      'Rural households have been slow to adopt rooftop solar, mainly',
      'As reported by Kumar et al.',
      'The barriers fall into three groups:',
    ])('%j', (before) => {
      const text = `the grid in these villages is unreliable. ${CITED}`;
      expect(dropUncitedLead(text, before)).toBe(text);
    });

    it('nor a lower-case first sentence after a finished one', () => {
      const text = `and the grid is unreliable. ${CITED}`;
      expect(dropUncitedLead(text, ENDS)).toBe(text);
    });
  });

  describe('keeps the pair when the cited sentence points back to the dropped one', () => {
    it.each([
      'However, upfront cost was the barrier most households named {{cite:S1#c1}}.',
      'This explains why upfront cost was the barrier most households named {{cite:S1#c1}}.',
      'These costs were the barrier most households named {{cite:S1#c1}}.',
      'It was the barrier most households named {{cite:S1#c1}}.',
      'For example, upfront cost was the barrier most households named {{cite:S1#c1}}.',
      'Such costs were the barrier most households named {{cite:S1#c1}}.',
      'Despite this, uptake rose by 12% after the subsidy {{cite:S1#c1}}.',
      'In contrast, urban households cited roof space {{cite:S1#c1}}.',
      'Consequently, uptake stayed below 5% {{cite:S1#c1}}.',
      'They named upfront cost as the main barrier {{cite:S1#c1}}.',
      '"These costs" were named by most households {{cite:S1#c1}}.',
    ])('%j', (second) => {
      const text = `${LEAD} ${second}`;
      expect(dropUncitedLead(text, ENDS)).toBe(text);
    });

    it('but not a sentence that merely starts with a common word', () => {
      for (const second of [
        'Studies in Karnataka found upfront cost the main barrier {{cite:S1#c1}}.',
        'Each additional day of app use lowered HbA1c by 0.016 points {{cite:S1#c1}}.',
        'There was no difference in HbA1c between the arms {{cite:S1#c1}}.',
        'The subsidy cut the payback period to six years {{cite:S1#c1}}.',
      ]) {
        expect(dropUncitedLead(`${LEAD} ${second}`, ENDS)).toBe(second);
      }
    });
  });

  it('a guided suggestion is left whole: the uncited sentence may be what was asked for', () => {
    const text = `${LEAD} ${CITED}`;
    expect(dropUncitedLead(text, ENDS, true)).toBe(text);
  });

  describe('Hindi and other scripts', () => {
    it('leaves a Devanagari pair as written (the pointing-back test is English)', () => {
      const hindi =
        'ग्रामीण परिवारों में छत पर सौर ऊर्जा धीरे-धीरे अपनाई जा रही है। लागत सबसे बड़ी बाधा थी {{cite:S1#c1}}।';
      expect(dropUncitedLead(hindi, 'कर्नाटक में सौर ऊर्जा।')).toBe(hindi);
    });

    it('leaves a Devanagari cited sentence after an English lead', () => {
      const text = `${LEAD} लागत सबसे बड़ी बाधा थी {{cite:S1#c1}}.`;
      expect(dropUncitedLead(text, ENDS)).toBe(text);
    });

    it('leaves a Devanagari lead with full stops whole when its next sentence is not Latin', () => {
      const text = 'सौर ऊर्जा महंगी है. लागत सबसे बड़ी बाधा थी {{cite:S1#c1}}.';
      expect(dropUncitedLead(text, '')).toBe(text);
    });
  });
});

describe('postProcessAssist with dropUncitedLead (A.1, ADR-0147 round 6)', () => {
  const ids = ['S1#c1', 'S2#c1'];
  const run = (output: string, before = ENDS, extra: Record<string, unknown> = {}) =>
    postProcessAssist({ output, passageIds: ids, before, existingText: before, ...extra });

  it('offers only the cited sentence, and reports only its citation', () => {
    const result = run(`${LEAD} ${CITED}`);
    expect(result.text).toBe(CITED);
    expect(result.cited).toEqual(['S1#c1']);
    expect(result.empty).toBe(false);
  });

  it('a citation after the full stop still counts as the sentence’s own', () => {
    const result = run(
      `${LEAD} Upfront cost was the barrier most households named. {{cite:S1#c1}}`,
    );
    expect(result.text).toBe('Upfront cost was the barrier most households named {{cite:S1#c1}}.');
  });

  it('a first sentence the model cited stays, even when one-paper-once later removes its marker', () => {
    const output =
      'High upfront costs remain the main barrier to household adoption {{cite:S1#c1}}. Lack of awareness further slows household adoption {{cite:S1#c1}}.';
    const result = run(output);
    expect(result.text).toContain('High upfront costs');
    expect(result.text).toContain('Lack of awareness');
  });

  it('a first sentence whose only marker was hallucinated is uncited, and goes', () => {
    const result = run(`${LEAD.replace('.', ' {{cite:Kumar 2017}}.')} ${CITED}`);
    expect(result.hallucinated).toEqual(['Kumar 2017']);
    expect(result.text).toBe(CITED);
  });

  it('runs after the connective opener is dropped, so "Additionally," no longer ties the pair', () => {
    const result = run(`${LEAD} Additionally, upfront cost was named most often {{cite:S1#c1}}.`);
    expect(result.text).toBe('Upfront cost was named most often {{cite:S1#c1}}.');
  });

  it('with citations turned off nothing is cited, so nothing is dropped', () => {
    const result = run(`${LEAD} ${CITED}`, ENDS, { autoCite: false });
    expect(result.text).toBe(`${LEAD} Upfront cost was the barrier most households named.`);
  });

  it('a guided suggestion keeps both sentences', () => {
    expect(run(`${LEAD} ${CITED}`, ENDS, { guided: true }).text).toBe(`${LEAD} ${CITED}`);
  });

  it('the evaluation’s without-code side keeps both sentences', () => {
    expect(run(`${LEAD} ${CITED}`, ENDS, { keepUncitedLead: true }).text).toBe(`${LEAD} ${CITED}`);
  });

  it('a mid-sentence continuation keeps the end of the student’s sentence', () => {
    const before = 'Rural households have been slow to adopt rooftop solar because';
    const result = run(`upfront payment is large. ${CITED}`, before);
    expect(result.text).toBe(`upfront payment is large. ${CITED}`);
  });

  it('a single uncited sentence is offered as before', () => {
    expect(run(LEAD).text).toBe(LEAD);
  });

  it('an uncited second sentence after a cited first is kept (unchanged behaviour)', () => {
    const text = `Subsidies cut the payback period to six years {{cite:S2#c1}}. ${LEAD}`;
    expect(run(text).text).toBe(text);
  });
});

describe('isOpening', () => {
  it.each([
    ['', true],
    ['   ', true],
    ['Chapter 1\n', true],
    ['Chapter 1\n  ', true],
    [`${ENDS}\nBarriers to adoption\n`, true],
    ['## Barriers to adoption\n', true],
    [ENDS, false],
    [`${ENDS}\n`, false],
    ['Chapter 1', false],
    ['Urban heat islands raise night-time temperatures because ', false],
  ])('%j → %s', (before, expected) => {
    expect(isOpening(before)).toBe(expected);
  });
});

describe('withheldOpening and the A.1 message', () => {
  const ABSTRACT =
    'Under the national scheme, residential rooftop solar adoption in Karnataka remains well below its technical potential. A survey of 412 households found upfront cost the main barrier. Subsidy delays added a further obstacle.';
  const opener: PromptPassage = {
    id: 'S1#c1',
    shortRef: 'Bagla 2026',
    page: null,
    text: ABSTRACT,
    opensAbstract: true,
  };
  const later: PromptPassage = {
    id: 'S1#c2',
    shortRef: 'Bagla 2026',
    page: 4,
    text: 'Households in Bengaluru cited roof ownership. Tenants could not install.',
  };

  it('withholds the first sentence of a passage that opens its abstract, at an opening', () => {
    expect(withheldOpening(opener, true)).toBe(
      'A survey of 412 households found upfront cost the main barrier. Subsidy delays added a further obstacle.',
    );
  });

  it('leaves the passage whole when the cursor is not at an opening', () => {
    expect(withheldOpening(opener, false)).toBe(ABSTRACT);
  });

  it('leaves every other passage whole', () => {
    expect(withheldOpening(later, true)).toBe(later.text);
    expect(withheldOpening({ ...opener, opensAbstract: false }, true)).toBe(ABSTRACT);
  });

  it('leaves a one-sentence abstract whole, so the passage is never emptied', () => {
    const one = { ...opener, text: 'Adoption in Karnataka remains low.' };
    expect(withheldOpening(one, true)).toBe(one.text);
  });

  it('keeps an abbreviation inside the first sentence from splitting it', () => {
    const p = {
      ...opener,
      text: 'Kumar et al. surveyed 412 households in Karnataka. Cost was the main barrier.',
    };
    expect(withheldOpening(p, true)).toBe('Cost was the main barrier.');
  });

  const message = (before: string, passages: PromptPassage[]) =>
    assistUserMessage({
      memoryBlock: '',
      chapter: { title: 'Chapter 1', scopeNote: null },
      passages,
      before,
      after: '',
      userId: 'u',
      documentId: 'd',
    });

  it('the opener request omits the abstract’s first sentence and keeps the passage’s id', () => {
    const m = message('Chapter 1\n', [opener, later]);
    expect(m).not.toContain('remains well below its technical potential');
    expect(m).toContain('A survey of 412 households found upfront cost the main barrier.');
    expect(m).toContain('S1#c1');
    expect(m).toContain('Bagla 2026');
    expect(m).toContain('Households in Bengaluru cited roof ownership.');
  });

  it('a typed sentence’s request sends the abstract whole', () => {
    const m = message(ENDS, [opener]);
    expect(m).toContain('remains well below its technical potential');
  });
});
