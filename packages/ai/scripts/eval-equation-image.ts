/**
 * Evaluation round for the equation-from-a-photo prompt (ADR-0064), against the real strong-tier
 * model from `.env`. Run:
 *   pnpm --filter @tc/ai exec dotenv -e ../../.env -- tsx scripts/eval-equation-image.ts <dir>
 * where <dir> holds eq0.png … and cases.json ([{ "latex": "…" }]) — images rendered from that
 * LaTeX with KaTeX in a browser. Typeset images only: handwriting and phone photos are not in this
 * round, and the ADR says so.
 *
 * A case passes when the answer renders and, once both are rendered to KaTeX's MathML (which
 * ignores spacing and redundant braces), it matches the source LaTeX.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv } from '@tc/config';
import katex from 'katex';
import { createProviders } from '../src/factory.js';
import {
  buildEquationImageRequest,
  equationResultSchema,
  postProcessEquation,
} from '../src/index.js';

const dir = process.argv[2];
if (!dir) throw new Error('give the directory of eq*.png and cases.json');
const cases = JSON.parse(readFileSync(join(dir, 'cases.json'), 'utf8')) as Array<{ latex: string }>;

/** The math as KaTeX's MathML, without its annotation, so equal maths compare equal. */
const mathml = (latex: string) =>
  katex
    .renderToString(latex.replace(/\\left|\\right/g, '').replace(/\\,|\\;|\\!/g, ''), {
      output: 'mathml',
      throwOnError: false,
    })
    .replace(/<annotation[\s\S]*?<\/annotation>/, '')
    .replace(/\s+/g, '');

const llm = createProviders(loadEnv()).llm;
let pass = 0;
let tokens = 0;
for (const [i, c] of cases.entries()) {
  const image = new Uint8Array(readFileSync(join(dir, `eq${i}.png`)));
  const req = buildEquationImageRequest({
    image,
    mediaType: 'image/png',
    userId: 'eval',
    documentId: 'eval',
    signal: AbortSignal.timeout(90_000),
  });
  try {
    const result = await llm.complete({ ...req, schema: equationResultSchema });
    tokens += result.usage.inputTokens + result.usage.outputTokens;
    const processed = postProcessEquation(result.value);
    const got = processed.ok ? processed.latex : '';
    const ok = got !== '' && mathml(got) === mathml(c.latex);
    if (ok) pass += 1;
    console.log(`${ok ? 'PASS' : 'MISS'}  ${c.latex}\n      -> ${got || '(none)'}`);
  } catch (error) {
    console.log(`FAIL  ${c.latex}\n      -> ${String(error)}`);
  }
}
console.log(`\n${pass}/${cases.length} matched; ${tokens} tokens in total.`);
