/**
 * Ready-made LaTeX for the equation field (2026-10-04, JENNI-FIX-LIST item 22).
 *
 * The field used to offer one hint, "E = mc^2", and a student who had never written LaTeX could
 * not get further. These are the patterns a thesis actually needs, each one a click away. Every
 * entry is checked by a test to draw in KaTeX, so nothing here can put red text in a thesis.
 *
 * Chemical formulas follow the preamble's rule 7: a compound *named in a sentence* (H₂O, Al₂O₃,
 * Fe³⁺) is ordinary text with Unicode subscripts, not an equation. Inside an equation — a
 * reaction — it is upright `\mathrm{…}`, never italic letters that read as variables.
 */

export type MathPattern = {
  /** A few words for the button and its tooltip. */
  label: string;
  latex: string;
};

/** The short row of examples above the field. */
export const MATH_EXAMPLES: readonly MathPattern[] = [
  { label: 'Fraction', latex: '\\frac{a}{b}' },
  { label: 'Square root', latex: '\\sqrt{x}' },
  { label: 'Power', latex: 'x^{2}' },
  { label: 'Subscript', latex: 'x_{i}' },
  { label: 'Sum', latex: '\\sum_{i=1}^{n} x_i' },
  { label: 'Integral', latex: '\\int_{a}^{b} f(x)\\,dx' },
  { label: 'Greek letter', latex: '\\alpha' },
  { label: 'Reaction', latex: '\\mathrm{2H_2 + O_2 \\rightarrow 2H_2O}' },
];

/** The cheat sheet behind the disclosure: the common patterns, roughly in the order taught. */
export const MATH_CHEAT_SHEET: readonly MathPattern[] = [
  { label: 'Fraction', latex: '\\frac{a}{b}' },
  { label: 'Square root', latex: '\\sqrt{x}' },
  { label: 'n-th root', latex: '\\sqrt[n]{x}' },
  { label: 'Power', latex: 'x^{2}' },
  { label: 'Subscript', latex: 'x_{i}' },
  { label: 'Subscript and power', latex: 'x_{i}^{2}' },
  { label: 'Sum', latex: '\\sum_{i=1}^{n} x_i' },
  { label: 'Product', latex: '\\prod_{i=1}^{n} x_i' },
  { label: 'Integral', latex: '\\int_{a}^{b} f(x)\\,dx' },
  { label: 'Limit', latex: '\\lim_{x \\to 0} f(x)' },
  { label: 'Derivative', latex: '\\frac{dy}{dx}' },
  { label: 'Partial derivative', latex: '\\frac{\\partial f}{\\partial x}' },
  { label: 'Matrix', latex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}' },
  { label: 'Greek letters', latex: '\\alpha, \\beta, \\gamma, \\mu, \\sigma' },
  { label: 'Capital Greek', latex: '\\Delta, \\Sigma, \\Omega' },
  { label: 'Accents', latex: '\\bar{x}, \\hat{\\beta}, \\dot{m}, \\vec{v}' },
  {
    label: 'Words in an equation',
    latex: 'v = \\frac{d}{t} \\text{ where } d \\text{ is distance}',
  },
  { label: 'Inequalities', latex: 'a \\leq b, \\; c \\geq d, \\; x \\neq y, \\; p \\approx q' },
  { label: 'Plus-minus and times', latex: 'a \\pm b, \\; a \\times b, \\; a \\cdot b' },
  { label: 'Sets', latex: 'x \\in A, \\; A \\subseteq B, \\; A \\cup B, \\; A \\cap B' },
  {
    label: 'Logic',
    latex: 'p \\land q, \\; \\neg p, \\; p \\Rightarrow q, \\; \\forall x \\, \\exists y',
  },
  { label: 'Tends to infinity', latex: 'n \\to \\infty' },
  { label: 'Mean', latex: '\\bar{x} = \\frac{1}{n} \\sum_{i=1}^{n} x_i' },
  { label: 'Chemical reaction', latex: '\\mathrm{2H_2 + O_2 \\rightarrow 2H_2O}' },
];

/**
 * `latex` with `snippet` put in place of the characters from `start` to `end` (the field's
 * selection), and where the caret goes after it.
 */
export function insertLatexAt(
  latex: string,
  snippet: string,
  start: number,
  end: number = start,
): { value: string; caret: number } {
  const from = Math.max(0, Math.min(start, latex.length));
  const to = Math.max(from, Math.min(end, latex.length));
  const before = latex.slice(0, from);
  // A space between a command and what follows it, so "\alpha" after "x" stays two tokens.
  const join = before && !/[\s{(^_]$/.test(before) ? ' ' : '';
  const value = `${before}${join}${snippet}${latex.slice(to)}`;
  return { value, caret: from + join.length + snippet.length };
}
