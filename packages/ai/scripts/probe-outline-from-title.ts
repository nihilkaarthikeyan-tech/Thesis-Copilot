/**
 * ADR-0072: one real A.9 outline call from a thesis title alone — the request the worker sends for
 * a "Start writing now" thesis (working title only, no problem statement, no objectives, no gap
 * map). Prints the tree's shape and what it cost, so the Sections panel's premise (chapters come
 * back with sections and scope notes) is checked against the configured strong model, not only
 * the mock. About ₹0.5 on gpt-5-mini.
 *
 *   pnpm --filter @tc/ai exec dotenv -e ../../.env -- tsx scripts/probe-outline-from-title.ts ["title"]
 */

import { computeCallCost, loadEnv, microToInr } from '@tc/config';
import {
  buildOutlineRequest,
  dropPlaceholderSections,
  enforceTemplateShape,
  outlineRequestSchema,
  readOutlineResult,
} from '../src/builder/outline.js';
import { createProviders } from '../src/factory.js';

const env = loadEnv();
const { llm } = createProviders(env);
const title = process.argv[2] ?? 'Barriers to rooftop solar adoption in rural Karnataka';
const request = buildOutlineRequest({
  template: 'STEM_EMPIRICAL',
  scope: { workingTitle: title, problemStatement: '', objectives: [] },
  userId: '00000000-0000-7000-8000-000000000001',
  documentId: '00000000-0000-7000-8000-000000000002',
  signal: AbortSignal.timeout(180_000),
});
const started = Date.now();
const result = await llm.complete({ ...request, schema: outlineRequestSchema });
// What the worker stores: the template's shape, then the slots the model left taken out.
const nodes = dropPlaceholderSections(
  enforceTemplateShape(readOutlineResult(result.value), 'STEM_EMPIRICAL'),
);
const cost = computeCallCost({ tier: 'strong', modelId: result.modelId, usage: result.usage });
console.log(
  JSON.stringify(
    {
      ms: Date.now() - started,
      model: result.modelId,
      usage: result.usage,
      inr: microToInr(cost),
      chapters: nodes.length,
      sections: nodes.map((n) => n.children.length),
    },
    null,
    2,
  ),
);
for (const node of nodes) {
  console.log(`\n${node.title}\n  ${node.scopeNote}`);
  for (const child of node.children) console.log(`  - ${child.title}: ${child.scopeNote}`);
}
