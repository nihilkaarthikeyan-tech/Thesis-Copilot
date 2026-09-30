/**
 * One real call to the citation-support check (2026-09-30) on the case a reviewer found in a
 * Jenni-written review: a stainless-steel finding cited for maraging steel. Also a control
 * sentence that says plainly the finding is from stainless steel, which must pass.
 *
 *   pnpm --filter @tc/ai exec dotenv -e ../../.env -- tsx scripts/probe-different-subject.ts
 *
 * Costs about ₹0.01. Kept as a script, not a test: it calls the real model.
 */

import { loadEnv } from '@tc/config';
import { buildSupportRequest, supportSchema } from '../src/builder/coherence.js';
import { createProviders } from '../src/factory.js';

const PASSAGE =
  'In laser powder bed fused 316L stainless steel, rapid solidification suppressed the formation ' +
  'of coarse MnS inclusions, which act as pitting initiation sites in wrought 316L; the as-built ' +
  'alloy therefore showed higher pitting potential in 3.5 wt% NaCl than its wrought counterpart.';

const env = loadEnv();
const llm = createProviders(env).llm;
const tier = process.argv.includes('--strong') ? 'strong' : 'fast';
const answer = await llm.complete({
  ...buildSupportRequest({
    items: [
      {
        sentenceId: 'applies-to-maraging',
        sentence:
          'In selective laser melted maraging steel, rapid solidification inhibits coarse MnS inclusions and so improves pitting resistance {{cite:S1#c1}}.',
        passages: [{ shortRef: 'Haghdadi 2020', page: 3, text: PASSAGE }],
      },
      {
        sentenceId: 'says-it-is-stainless',
        sentence:
          'In 316L stainless steel, rapid solidification suppressed coarse MnS inclusions and raised the pitting potential; whether the same holds for maraging steel is untested {{cite:S1#c1}}.',
        passages: [{ shortRef: 'Haghdadi 2020', page: 3, text: PASSAGE }],
      },
    ],
    userId: 'probe',
    documentId: 'probe',
  }),
  schema: supportSchema,
  tier,
});
console.log(tier, answer.modelId);
console.log(JSON.stringify(answer.value, null, 2));
