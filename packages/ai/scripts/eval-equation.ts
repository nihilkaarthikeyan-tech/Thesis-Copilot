/**
 * Evaluation round for the equation-from-words prompt (ADR-0063), against the real strong-tier
 * model from `.env`. Run: `pnpm --filter @tc/ai exec dotenv -e ../../.env -- tsx scripts/eval-equation.ts`.
 *
 * The cases are written by the agent, not collected from students: each pairs a description a
 * student might type with the LaTeX a careful person would write for it. A case passes when the
 * answer renders (the same KaTeX check the product applies) and, once whitespace and redundant
 * braces are normalised, matches one of the accepted forms. The result goes to docs/BUILD_LOG.md.
 */

import { loadEnv } from '@tc/config';
import { createProviders } from '../src/factory.js';
import { buildEquationRequest, equationResultSchema, postProcessEquation } from '../src/index.js';

const CASES: Array<{ say: string; accept: string[]; current?: string }> = [
  {
    say: 'y equals beta zero plus beta one times x plus epsilon',
    accept: [
      'y=\\beta_0+\\beta_1x+\\epsilon',
      'y=\\beta_{0}+\\beta_{1}x+\\epsilon',
      'y=\\beta_0+\\beta_1\\cdotx+\\epsilon',
      'y=\\beta_0+\\beta_1\\timesx+\\epsilon',
      'y=\\beta_{0}+\\beta_{1}\\timesx+\\epsilon',
      'y=\\beta_{0}+\\beta_{1}\\cdotx+\\epsilon',
      'y=\\beta_0+\\beta_1x+\\varepsilon',
      'y=\\beta_{0}+\\beta_{1}x+\\varepsilon',
    ],
  },
  {
    say: 'the mean x bar equals the sum of x i from i equals 1 to n, divided by n',
    accept: [
      '\\bar{x}=\\frac{\\sum_{i=1}^{n}x_i}{n}',
      '\\bar{x}=\\frac{\\sum_{i=1}^{n}x_{i}}{n}',
      '\\bar{x}=\\frac{1}{n}\\sum_{i=1}^{n}x_i',
      '\\bar{x}=\\frac{1}{n}\\sum_{i=1}^{n}x_{i}',
    ],
  },
  {
    say: 'square root of a squared plus b squared',
    accept: ['\\sqrt{a^2+b^2}', '\\sqrt{a^{2}+b^{2}}'],
  },
  { say: 'E equals m c squared', accept: ['E=mc^2', 'E=mc^{2}'] },
  {
    say: 'sigma squared equals one over n minus one times the sum of x i minus x bar squared',
    accept: [
      '\\sigma^2=\\frac{1}{n-1}\\sum(x_i-\\bar{x})^2',
      '\\sigma^{2}=\\frac{1}{n-1}\\sum(x_{i}-\\bar{x})^{2}',
      '\\sigma^2=\\frac{1}{n-1}\\sum_{i}(x_i-\\bar{x})^2',
      '\\sigma^{2}=\\frac{1}{n-1}\\sum_{i=1}^{n}(x_{i}-\\bar{x})^{2}',
      '\\sigma^2=\\frac{1}{n-1}\\sum_{i=1}^{n}(x_i-\\bar{x})^2',
    ],
  },
  {
    say: 'integral from 0 to infinity of e to the minus x d x',
    accept: [
      '\\int_{0}^{\\infty}e^{-x}dx',
      '\\int_0^\\inftye^{-x}dx',
      '\\int_{0}^{\\infty}e^{-x}\\,dx',
      '\\int_0^{\\infty}e^{-x}\\,dx',
      '\\int_{0}^{\\infty}e^{-x}\\mathrm{d}x',
      '\\int_{0}^{\\infty}e^{-x}\\,\\mathrm{d}x',
    ],
  },
  {
    say: 'the efficiency eta equals useful output power over input power',
    accept: [
      '\\eta=\\frac{P_{out}}{P_{in}}',
      '\\eta=\\frac{\\text{usefuloutputpower}}{\\text{inputpower}}',
      '\\eta=\\frac{P_{\\text{out}}}{P_{\\text{in}}}',
      '\\eta=\\frac{\\text{Usefuloutputpower}}{\\text{Inputpower}}',
    ],
  },
  { say: 'p hat equals x over n', accept: ['\\hat{p}=\\frac{x}{n}'] },
  {
    say: 'alpha plus beta is greater than or equal to one',
    accept: ['\\alpha+\\beta\\geq1', '\\alpha+\\beta\\ge1'],
  },
  {
    say: 'the limit as n goes to infinity of one plus one over n, to the power n',
    accept: [
      '\\lim_{n\\to\\infty}(1+\\frac{1}{n})^n',
      '\\lim_{n\\to\\infty}\\left(1+\\frac{1}{n}\\right)^n',
      '\\lim_{n\\to\\infty}\\left(1+\\frac{1}{n}\\right)^{n}',
      '\\lim_{n\\to\\infty}(1+\\frac{1}{n})^{n}',
    ],
  },
  { say: 'make the power three instead', current: 'x^2+y^2', accept: ['x^3+y^3', 'x^{3}+y^{3}'] },
  { say: 'delta G equals delta H minus T delta S', accept: ['\\DeltaG=\\DeltaH-T\\DeltaS'] },
  { say: 'please summarise my chapter', accept: [''] },
  {
    say: 'rate of change of y with respect to t equals k times y',
    accept: [
      '\\frac{dy}{dt}=ky',
      '\\frac{\\mathrm{d}y}{\\mathrm{d}t}=ky',
      '\\frac{dy}{dt}=k\\cdoty',
      '\\frac{dy}{dt}=k\\timesy',
    ],
  },
];

/** Whitespace out, and `{x}` around a single character treated as `x`, for comparison only. */
const norm = (s: string) =>
  s
    .replace(/\s+/g, '')
    .replace(/\{(\\?[A-Za-z0-9])\}/g, '$1')
    .replace(/\\left|\\right/g, '');

const env = loadEnv();
const llm = createProviders(env).llm;

let pass = 0;
let costTokens = 0;
for (const c of CASES) {
  const req = buildEquationRequest({
    description: c.say,
    current: c.current ?? null,
    userId: 'eval',
    documentId: 'eval',
    signal: AbortSignal.timeout(60_000),
  });
  try {
    const result = await llm.complete({ ...req, schema: equationResultSchema });
    costTokens += result.usage.inputTokens + result.usage.outputTokens;
    const processed = postProcessEquation(result.value);
    const got = processed.ok ? processed.latex : '';
    const ok = c.accept.map(norm).includes(norm(got));
    if (ok) pass += 1;
    console.log(
      `${ok ? 'PASS' : 'MISS'}  ${c.say}\n      -> ${got || '(none)'}  | ${result.value.reading}`,
    );
  } catch (error) {
    console.log(`FAIL  ${c.say}\n      -> ${String(error)}`);
  }
}
console.log(`\n${pass}/${CASES.length} matched an accepted form; ${costTokens} tokens in total.`);
