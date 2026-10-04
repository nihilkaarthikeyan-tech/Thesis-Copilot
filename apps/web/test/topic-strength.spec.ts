import { describe, expect, it } from 'vitest';
import { EXAMPLE_TOPICS, LENGTH_HINT, scoreTopic, TOPIC_HINTS } from '../src/lib/topic-strength';

const missing = (text: string) =>
  scoreTopic(text)
    .checks.filter((c) => !c.met)
    .map((c) => c.part);

describe('how complete a topic sentence is', () => {
  it('calls an empty box weak and gives no length hint for it', () => {
    const score = scoreTopic('   ');
    expect(score.strength).toBe('weak');
    expect(score.words).toBe(0);
    expect(score.hints).not.toContain(LENGTH_HINT);
  });

  it('calls a bare subject weak and asks for where, how and why', () => {
    const score = scoreTopic('Mangrove soil carbon');
    expect(score.strength).toBe('weak');
    expect(missing('Mangrove soil carbon')).toEqual(['setting', 'method', 'aim']);
    expect(score.hints).toContain(TOPIC_HINTS.setting);
    expect(score.hints).toContain(LENGTH_HINT);
  });

  it('calls a subject with a place and an aim fair, and still asks for the method', () => {
    const text = 'Effect of stand age on soil organic carbon in Pichavaram mangroves';
    expect(scoreTopic(text).strength).toBe('fair');
    expect(missing(text)).toEqual(['method']);
    expect(scoreTopic(text).hints).toEqual([TOPIC_HINTS.method]);
  });

  it('calls a full sentence strong', () => {
    const text =
      'Comparing soil organic carbon in restored and natural mangroves at Pichavaram, Tamil Nadu, using core sampling';
    const score = scoreTopic(text);
    expect(score.strength).toBe('strong');
    expect(score.hints).toEqual([]);
  });

  it('needs length as well as the parts: four parts in five words is only fair', () => {
    expect(scoreTopic('Nurses in Chennai: survey effects').strength).toBe('fair');
  });

  it('recognises a population without a place name', () => {
    expect(scoreTopic('Stress among nursing students').checks[1]).toEqual({
      part: 'setting',
      met: true,
      hint: TOPIC_HINTS.setting,
    });
  });

  it('recognises a proper noun after a preposition as a setting', () => {
    expect(missing('Water quality in Vembanad lake')).not.toContain('setting');
  });

  it('recognises a question as an aim', () => {
    expect(missing('Do drip kits pay back for Kolar farmers?')).not.toContain('aim');
  });

  it('rates every example in the placeholder as strong', () => {
    for (const example of EXAMPLE_TOPICS) {
      expect(scoreTopic(example).strength, example).toBe('strong');
      expect(scoreTopic(example).hints, example).toEqual([]);
    }
  });
});
