/**
 * One real key-term extraction, with the provider's error printed whole — written on 2026-10-01
 * when the first real plan step failed with "OpenAI structured call failed" and the cause was
 * not in the log. Costs a fraction of a paisa on gpt-5-nano.
 *
 *   pnpm --filter @tc/ai exec dotenv -e ../../.env -- tsx scripts/probe-entities.ts
 */

import { disciplineProfile, loadEnv } from '@tc/config';
import {
  buildEntitiesRequest,
  entitiesSchema,
  postProcessEntities,
} from '../src/builder/chapter-build.js';
import { createProviders } from '../src/factory.js';

const env = loadEnv();
const { llm } = createProviders(env);
const discipline = disciplineProfile('engineering_core_v1');
const input = {
  title: 'Composite versus conventional electrodes in EDM of Hastelloy C-276',
  objectives: [
    'To compare tool wear rate of copper, graphite and copper-tungsten electrodes in EDM of Hastelloy C-276.',
    'To measure the effect of peak current and pulse-on time on material removal rate and surface roughness.',
    'To relate the recast layer thickness to the electrode material and discharge energy.',
  ],
  questions: [] as string[],
  hypotheses: [] as string[],
  entityTypes: discipline.entityTypes,
  userId: '00000000-0000-7000-8000-000000000001',
  documentId: '00000000-0000-7000-8000-000000000002',
};
const request = buildEntitiesRequest(input);
const started = Date.now();
try {
  const result = await llm.complete({ ...request, schema: entitiesSchema });
  console.log(
    JSON.stringify(
      { ms: Date.now() - started, model: result.modelId, usage: result.usage },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(result.value, null, 2));
  console.log(JSON.stringify(postProcessEntities(result.value, input), null, 2));
} catch (error) {
  console.error('FAILED after', Date.now() - started, 'ms');
  console.error(error);
  const cause = (error as { cause?: unknown }).cause;
  if (cause) {
    console.error('CAUSE:', cause);
    const inner = (cause as { cause?: unknown; responseBody?: unknown; data?: unknown }).cause;
    if (inner) console.error('INNER:', inner);
    if ((cause as { responseBody?: unknown }).responseBody)
      console.error('BODY:', (cause as { responseBody?: unknown }).responseBody);
  }
  process.exit(1);
}
