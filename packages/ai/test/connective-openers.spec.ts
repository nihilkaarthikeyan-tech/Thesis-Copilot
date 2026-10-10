/**
 * ADR-0147 round 2: a bare connective opener ("Additionally,", "Furthermore,", "Moreover,",
 * "In addition,", "Notably,", "Importantly,") at the start of an Assist sentence is dropped and the
 * next word capitalised; in a mid-sentence continuation it is kept.
 */

import { describe, expect, it } from 'vitest';
import { dropConnectiveOpeners, endsSentence } from '../src/builder/academic-style.js';
import { postProcessAssist } from '../src/builder/postprocess.js';

const FULL = 'Graphite electrodes wore less than copper at high peak current {{cite:S1#c1}}. ';

describe('endsSentence', () => {
  it.each([
    ['', true],
    ['Chapter 1\n', true],
    ['The yield rose by 12%.', true],
    ['The yield rose by 12% {{cite:S1#c1}}.', true],
    ['The yield rose (Kumar et al., 2017). ', true],
    ['The yield rose. {{cite:S1#c1}} ', true],
    ['Urban heat islands raise night-time temperatures because ', false],
    ['As shown by Kumar et al.', false],
    ['The results were as follows:', false],
  ])('%j → %s', (before, expected) => {
    expect(endsSentence(before)).toBe(expected);
  });
});

describe('dropConnectiveOpeners', () => {
  it('drops each opener at the start when the text before ends a sentence', () => {
    for (const opener of [
      'Additionally',
      'Furthermore',
      'Moreover',
      'In addition',
      'Notably',
      'Importantly',
    ]) {
      expect(dropConnectiveOpeners(`${opener}, the tool wore 40% less {{cite:S2#c1}}.`, FULL)).toBe(
        'The tool wore 40% less {{cite:S2#c1}}.',
      );
    }
  });

  it('drops an opener that starts the second sentence of the suggestion', () => {
    const text =
      'Finer grains reduced roughness {{cite:S1#c1}}. Additionally, peak current governed removal rate {{cite:S2#c1}}.';
    expect(dropConnectiveOpeners(text, 'The ')).toBe(
      'Finer grains reduced roughness {{cite:S1#c1}}. Peak current governed removal rate {{cite:S2#c1}}.',
    );
  });

  it('drops a second-sentence opener after a citation that follows the full stop', () => {
    expect(
      dropConnectiveOpeners('Wear fell. {{cite:S1#c1}} Moreover, cost rose {{cite:S2#c1}}.', FULL),
    ).toBe('Wear fell. {{cite:S1#c1}} Cost rose {{cite:S2#c1}}.');
  });

  it('keeps the opener in a mid-sentence continuation', () => {
    const text = 'furthermore, it lowers wear {{cite:S1#c1}}.';
    expect(dropConnectiveOpeners(text, 'Graphite is cheap and ')).toBe(text);
    const capital = 'Moreover, the tool wore less {{cite:S1#c1}}.';
    expect(dropConnectiveOpeners(capital, 'The results show that ')).toBe(capital);
  });

  it('keeps a connective that is not bare', () => {
    for (const text of [
      'In addition to cost, wear fell {{cite:S1#c1}}.',
      'Notably higher yields were reported {{cite:S1#c1}}.',
      'Moreover the yield rose {{cite:S1#c1}}.',
      'However, the yield rose {{cite:S1#c1}}.',
    ]) {
      expect(dropConnectiveOpeners(text, FULL)).toBe(text);
    }
  });

  it('leaves an opener followed by a citation marker as written', () => {
    const text = 'Additionally, {{cite:S1#c1}} reports lower wear.';
    expect(dropConnectiveOpeners(text, FULL)).toBe(text);
  });

  it('does not capitalise a mixed-case first word', () => {
    expect(dropConnectiveOpeners('Moreover, pH fell to 5.2 {{cite:S1#c1}}.', FULL)).toBe(
      'pH fell to 5.2 {{cite:S1#c1}}.',
    );
    expect(dropConnectiveOpeners('Notably, mRNA levels rose {{cite:S1#c1}}.', FULL)).toBe(
      'mRNA levels rose {{cite:S1#c1}}.',
    );
  });

  it('keeps a capitalised next word and digits as they are', () => {
    expect(dropConnectiveOpeners('Furthermore, Kerala reported 12% {{cite:S1#c1}}.', FULL)).toBe(
      'Kerala reported 12% {{cite:S1#c1}}.',
    );
    expect(dropConnectiveOpeners('Additionally, 40% of wells fell {{cite:S1#c1}}.', FULL)).toBe(
      '40% of wells fell {{cite:S1#c1}}.',
    );
  });

  it('does not treat "et al." as a sentence end', () => {
    const text = 'As Kumar et al. Moreover, noted {{cite:S1#c1}}.';
    expect(dropConnectiveOpeners(text, 'The ')).toBe(text);
  });

  it('leaves Hindi and other scripts untouched', () => {
    const hindi = 'इसके अतिरिक्त, ग्रामीण परिवारों में लागत मुख्य बाधा थी {{cite:S1#c1}}।';
    expect(dropConnectiveOpeners(hindi, 'पहला वाक्य। ')).toBe(hindi);
  });

  it('is idempotent and changes nothing without an opener', () => {
    const text = 'Wear fell by 30% {{cite:S1#c1}}. Cost rose {{cite:S2#c1}}.';
    expect(dropConnectiveOpeners(text, FULL)).toBe(text);
    const once = dropConnectiveOpeners('Moreover, wear fell {{cite:S1#c1}}.', FULL);
    expect(dropConnectiveOpeners(once, FULL)).toBe(once);
  });
});

describe('postProcessAssist with the opener rule', () => {
  const passageIds = ['S1#c1', 'S2#c1'];

  it('removes the padded openers from what the student is offered', () => {
    const out = postProcessAssist({
      output:
        'Additionally, finer grains reduced roughness {{cite:S1#c1}}. Furthermore, peak current governed removal rate {{cite:S2#c1}}.',
      passageIds,
      before: FULL,
    });
    expect(out.text).toBe(
      'Finer grains reduced roughness {{cite:S1#c1}}. Peak current governed removal rate {{cite:S2#c1}}.',
    );
    expect(out.cited).toEqual(['S1#c1', 'S2#c1']);
  });

  it('keeps a mid-sentence opener but still drops one that starts the second sentence', () => {
    const out = postProcessAssist({
      output: 'moreover, it wore less {{cite:S1#c1}}. Moreover, it cost less {{cite:S2#c1}}.',
      passageIds,
      before: 'Graphite machined faster and ',
    });
    expect(out.text).toBe('moreover, it wore less {{cite:S1#c1}}. It cost less {{cite:S2#c1}}.');
  });
});
