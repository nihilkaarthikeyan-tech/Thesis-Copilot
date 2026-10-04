import { describe, expect, it } from 'vitest';
import { questionOptions } from '../src/lib/question-options';

const texts = (question: string) => questionOptions(question).map((o) => o.text);

describe('the options in a proposal question', () => {
  it('reads "1) … 2) …" written inline, and marks "Something else"', () => {
    const options = questionOptions(
      'Which comparison matters most? Choose one: 1) Restored versus natural stands, 2) Carbon by stand age, 3) Carbon by depth, or 4) Something else.',
    );
    expect(options).toEqual([
      { text: 'Restored versus natural stands', other: false },
      { text: 'Carbon by stand age', other: false },
      { text: 'Carbon by depth', other: false },
      { text: 'Something else', other: true },
    ]);
  });

  it('reads "1. …" on separate lines and stops the last one at its line', () => {
    expect(
      texts(
        'Which setting?\n1. One district\n2. One state\n3. A national comparison\nReply with your choice.',
      ),
    ).toEqual(['One district', 'One state', 'A national comparison']);
  });

  it('reads "(1) …" and "(a) …"', () => {
    expect(texts('Pick one: (1) policy (2) technology adoption (3) economic impact')).toEqual([
      'policy',
      'technology adoption',
      'economic impact',
    ]);
    expect(
      texts(
        'Is this mainly about (a) policy, (b) technology adoption, (c) economic impact, or something else?',
      ),
    ).toEqual(['policy', 'technology adoption', 'economic impact', 'Something else']);
  });

  it('turns a trailing "or something else" into its own open choice', () => {
    expect(
      questionOptions('Which: 1) a survey you run, 2) existing datasets, or something else?'),
    ).toEqual([
      { text: 'a survey you run', other: false },
      { text: 'existing datasets', other: false },
      { text: 'Something else', other: true },
    ]);
  });

  it('drops markdown bold around an option', () => {
    expect(texts('Choose: 1) **Field cores** 2) **Satellite imagery**')).toEqual([
      'Field cores',
      'Satellite imagery',
    ]);
  });

  it('offers no buttons for a question without a list', () => {
    expect(questionOptions('Which district is the study in?')).toEqual([]);
  });

  it('offers no buttons for a single option, or for more than six', () => {
    expect(questionOptions('Do you mean 1) mangroves only?')).toEqual([]);
    expect(questionOptions('1) a 2) b 3) c 4) d 5) e 6) f 7) g')).toEqual([]);
  });

  it('ignores numbers that are not a run from 1: years, decimals, a stray "2)"', () => {
    expect(questionOptions('Since 2015. the stands are 2.5 m tall; see note 2) above.')).toEqual(
      [],
    );
    expect(texts('Within 15 years. Choose: 1) yes 2) no')).toEqual(['yes', 'no']);
  });

  it('never reads "e.g." or a capital "A." as a marker', () => {
    expect(questionOptions('A. The topic is broad, e.g. policy or practice.')).toEqual([]);
  });

  it('reads (A) … (D), as the model wrote it in a live run (2026-10-04)', () => {
    const q =
      'Should the thesis focus on (pick one): (A) a chronosequence comparing restored stands of different ages (e.g., <5, 5–15, >15 years) vs natural stands; (B) depth-profile SOC recovery (e.g., 0–10, 10–30, 30–50 cm) in restored vs natural stands; (C) scaling plot-level SOC estimates to the Pichavaram landscape using Sentinel-2; or (D) something else?';
    const options = questionOptions(q);
    expect(options).toHaveLength(4);
    expect(options[0]?.text).toMatch(/^a chronosequence comparing restored stands/);
    expect(options[2]?.text).toBe(
      'scaling plot-level SOC estimates to the Pichavaram landscape using Sentinel-2',
    );
    expect(options[3]).toEqual({ text: 'something else', other: true });
  });
});
