/**
 * ADR-0072: real A.9 outline calls from a thesis title alone — the request the worker sends for
 * a "Start writing now" thesis (working title only, no problem statement, no objectives, no gap
 * map). Prints each tree as the worker stores it (ADR-0138: with the sub-sections added in code),
 * the Literature Review's section count, the sub-section count and what it cost. About ₹0.5 a
 * title on gpt-5-mini. Titles run one after another.
 *
 *   pnpm --filter @tc/ai exec dotenv -e ../../.env -- tsx scripts/probe-outline-from-title.ts ["title" …]
 */

import { computeCallCost, loadEnv, microToInr } from '@tc/config';
import {
  buildOutlineRequest,
  dropPlaceholderSections,
  enforceTemplateShape,
  outlineRequestSchema,
  readOutlineResult,
} from '../src/builder/outline.js';
import { addSubsections } from '../src/builder/subsections.js';
import { createProviders } from '../src/factory.js';

const env = loadEnv();
const { llm } = createProviders(env);
const titles =
  process.argv.length > 2
    ? process.argv.slice(2)
    : ['Barriers to rooftop solar adoption in rural Karnataka'];

let totalInr = 0;
const summary: Array<Record<string, unknown>> = [];
for (const title of titles) {
  const request = buildOutlineRequest({
    template: 'STEM_EMPIRICAL',
    scope: { workingTitle: title, problemStatement: '', objectives: [] },
    userId: '00000000-0000-7000-8000-000000000001',
    documentId: '00000000-0000-7000-8000-000000000002',
    signal: AbortSignal.timeout(180_000),
  });
  const started = Date.now();
  const result = await llm.complete({ ...request, schema: outlineRequestSchema });
  // What the worker stores: the template's shape, the slots taken out, the sub-sections added.
  const nodes = addSubsections(
    dropPlaceholderSections(
      enforceTemplateShape(readOutlineResult(result.value), 'STEM_EMPIRICAL'),
    ),
    'STEM_EMPIRICAL',
  );
  const inr = microToInr(
    computeCallCost({ tier: 'strong', modelId: result.modelId, usage: result.usage }),
  );
  totalInr += inr;
  const lr = nodes.find((n) => /literature/i.test(n.title));
  const subs = nodes.flatMap((n) => n.children).reduce((a, s) => a + s.children.length, 0);
  const elsewhere = nodes
    .filter((n) => !/literature|method/i.test(n.title))
    .flatMap((n) => n.children)
    .reduce((a, s) => a + s.children.length, 0);
  const row = {
    title,
    ms: Date.now() - started,
    model: result.modelId,
    inr,
    lrSections: lr?.children.length ?? 0,
    subSections: subs,
    subSectionsElsewhere: elsewhere,
  };
  summary.push(row);
  console.log(`\n=== ${title}\n${JSON.stringify(row)}`);
  for (const node of nodes) {
    console.log(node.title);
    for (const child of node.children) {
      console.log(`  - ${child.title}`);
      for (const sub of child.children) {
        console.log(
          `      · ${sub.title}${sub.scopeNote ? `  [${sub.scopeNote.slice(0, 90)}…]` : ''}`,
        );
      }
    }
  }
}
console.log(`\n${JSON.stringify({ runs: summary.length, totalInr }, null, 2)}`);
