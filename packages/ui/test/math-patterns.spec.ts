import { describe, expect, it } from 'vitest';
import { latexError } from '../src/editor/math.js';
import { insertLatexAt, MATH_CHEAT_SHEET, MATH_EXAMPLES } from '../src/editor/math-patterns.js';

describe('the equation patterns', () => {
  it('every example and cheat-sheet entry draws in KaTeX', () => {
    for (const pattern of [...MATH_EXAMPLES, ...MATH_CHEAT_SHEET]) {
      expect(latexError(pattern.latex), pattern.label).toBeNull();
    }
  });

  it('covers what the cheat sheet promises', () => {
    const labels = MATH_CHEAT_SHEET.map((p) => p.label.toLowerCase()).join(' | ');
    for (const word of [
      'fraction',
      'root',
      'sum',
      'integral',
      'limit',
      'derivative',
      'partial',
      'matrix',
      'greek',
      'subscript',
      'accents',
      'words',
      'inequalities',
      'sets',
      'logic',
    ]) {
      expect(labels).toContain(word);
    }
    expect(MATH_CHEAT_SHEET.length).toBeGreaterThanOrEqual(20);
  });

  it('writes a chemical formula upright, not as italic variables', () => {
    const reaction = MATH_EXAMPLES.find((p) => p.label === 'Reaction');
    expect(reaction?.latex).toMatch(/^\\mathrm\{/);
  });
});

describe('insertLatexAt', () => {
  it('fills an empty field', () => {
    expect(insertLatexAt('', '\\frac{a}{b}', 0)).toEqual({ value: '\\frac{a}{b}', caret: 11 });
  });

  it('inserts at the caret, replacing a selection', () => {
    expect(insertLatexAt('x = ', '\\sqrt{y}', 4)).toEqual({ value: 'x = \\sqrt{y}', caret: 12 });
    expect(insertLatexAt('x = AB + 1', '\\alpha', 4, 6)).toEqual({
      value: 'x = \\alpha + 1',
      caret: 10,
    });
  });

  it('keeps a command apart from the token before it', () => {
    expect(insertLatexAt('x', '\\alpha', 1).value).toBe('x \\alpha');
    expect(insertLatexAt('x^{', '2', 3).value).toBe('x^{2');
  });

  it('clamps a caret outside the text', () => {
    expect(insertLatexAt('ab', 'c', 99).value).toBe('ab c');
  });
});
