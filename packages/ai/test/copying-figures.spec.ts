/**
 * ADR-0147 round 5: `run6Figures`, the copying measure the owner settled ("fix this",
 * 2026-10-10). A six-word run shared with a passage counts as copying unless its words are a
 * figure with its unit and the name of the quantity measured; ordinary phrasing, lists of
 * findings in the passage's order, product and study names and an abstract's own sentence still
 * count. The measure lives in the evaluation (`eval/copying.ts`), not the product.
 */

import { describe, expect, it } from 'vitest';
import { measure, passageFigureTokens, totals } from '../eval/copying.js';
import type { PromptPassage } from '../src/builder/assist.js';

const passage = (text: string, id = 'S1#c1'): PromptPassage => ({
  id,
  shortRef: 'Smith 2024',
  page: null,
  text,
});

const discounted = (text: string) =>
  passageFigureTokens(text)
    .filter((t) => t.name)
    .map((t) => t.word)
    .join(' ');

describe('passageFigureTokens: a figure, its unit and the quantity measured', () => {
  it('discounts the owner\'s example whole: "a 0.016 point decrease in HbA1c"', () => {
    expect(
      discounted(
        'Each additional day of app use corresponded with a 0.016 point decrease in HbA1c.',
      ),
    ).toBe('a 0 016 point decrease in hba1c');
  });

  it('discounts a count with what it counts, and a quantity named before its figure', () => {
    expect(discounted('The trial enrolled 223 participants across sites.')).toBe(
      '223 participants',
    );
    expect(discounted('Respondents had a mean age of 45 years.')).toBe('mean age of 45 years');
    expect(discounted('Glycated haemoglobin fell by 0.5 per cent overall.')).toBe(
      'glycated haemoglobin fell by 0 5 per cent',
    );
    expect(discounted('Households paid Rs 500 per month for electricity.')).toBe(
      'rs 500 per month',
    );
  });

  it('discounts nothing in a sentence without a figure, names included', () => {
    expect(
      discounted(
        'The BlueStar mobile app showed a higher pitting potential, lower corrosion current density and lower corrosion rate.',
      ),
    ).toBe('');
  });
});

describe('measure: run6Figures beside run6 and run6Names', () => {
  const diabetes = passage(
    'A pragmatic randomized controlled trial of the BlueStar mobile app enrolled 223 participants. Each additional day of app use corresponded with a 0.016 point decrease in HbA1c among adolescents.',
  );

  it('does not count a figure cited exactly with its unit and quantity', () => {
    const m = measure(
      'Daily use mattered: every day of use brought a 0.016 point decrease in HbA1c {{cite:S1#c1}}.',
      [diabetes],
    );
    expect(m.longestRun).toBeGreaterThanOrEqual(6);
    expect(m.longestRunFigures).toBeLessThan(6);
  });

  it("still counts the passage's ordinary phrasing around a figure", () => {
    const m = measure(
      'Each additional day of app use corresponded with lower glucose {{cite:S1#c1}}.',
      [diabetes],
    );
    expect(m.longestRunFigures).toBeGreaterThanOrEqual(6);
    expect(m.runTextFigures).toContain('each additional day of app use corresponded with');
  });

  it('still counts a product or study name, which run6Names discounts', () => {
    const m = measure(
      'Evidence comes from a pragmatic randomized controlled trial of the BlueStar mobile app {{cite:S1#c1}}.',
      [diabetes],
    );
    expect(m.longestRunFigures).toBeGreaterThanOrEqual(8);
    expect(m.longestRunFigures).toBeGreaterThan(m.longestRunNames);
  });

  it("still counts a list of findings kept in the passage's order", () => {
    const corrosion = passage(
      'The coated samples showed a higher pitting potential, lower corrosion current density and lower corrosion rate than the bare alloy.',
    );
    const m = measure(
      'Coating gave the alloy a higher pitting potential, lower corrosion current density and lower corrosion rate {{cite:S1#c1}}.',
      [corrosion],
    );
    expect(m.longestRunFigures).toBeGreaterThanOrEqual(6);
  });

  it("still counts an abstract's own first sentence restated", () => {
    const fish = passage(
      'Dried fish are aquatic animals preserved using simple techniques such as sun drying, salting, fermentation and smoking.',
    );
    const m = measure(
      'Dried fish are aquatic animals preserved using simple techniques such as sun drying {{cite:S1#c1}}.',
      [fish],
    );
    expect(m.longestRunFigures).toBeGreaterThanOrEqual(6);
  });

  it('never counts more than raw run6, and totals report it per output', () => {
    const outputs = [
      'Daily use mattered: every day of use brought a 0.016 point decrease in HbA1c {{cite:S1#c1}}.',
      'Each additional day of app use corresponded with lower glucose {{cite:S1#c1}}.',
      'Glucose control improved with use {{cite:S1#c1}}.',
    ].map((text) => measure(text, [diabetes]));
    for (const m of outputs) expect(m.longestRunFigures).toBeLessThanOrEqual(m.longestRun);
    const t = totals(outputs);
    expect(t.run6).toBe(2);
    expect(t.run6Figures).toBe(1);
  });
});
