/**
 * Evaluation round for the edit actions (ADR-0066), against the real strong-tier model from
 * `.env`. Run: `pnpm --filter @tc/ai exec dotenv -e ../../.env -- tsx scripts/eval-edit-actions.ts`.
 *
 * Agent-written thesis sentences, each run through every action. Checked in code: the grounding
 * check (no citation invented, none dropped) and, for each action, a cheap signal that it did its
 * job; the outputs are printed for a person to read, and the round's verdict is in the ADR.
 */

import { loadEnv } from '@tc/config';
import { createProviders } from '../src/factory.js';
import {
  buildCommandRequest,
  commandResultSchema,
  EDIT_ACTIONS,
  postProcessCommand,
} from '../src/index.js';

const MEMORY =
  '<memory>Thesis: Barriers to rooftop solar adoption among rural households in Karnataka.</memory>';
const SELECTIONS = [
  'The survey shows that upfront cost causes low adoption in all districts {{cite:k1}}. Households with access to credit adopted at twice the rate {{cite:k2}}.',
  'It could perhaps be argued that net-metering delays are an important barrier {{cite:k3}}. Interviews were conducted by the researcher in two villages.',
  'This study examines why adoption remains low. Previous work finds that awareness is not the main constraint {{cite:k1}}.',
];
const PASSAGES = [
  {
    id: 'S1#c1',
    shortRef: 'Rao 2021',
    page: null,
    text: 'In a panel of 600 households, falling panel prices did not raise adoption where subsidy approval took more than six months.',
  },
  {
    id: 'S2#c4',
    shortRef: 'Iyer 2020',
    page: null,
    text: 'Credit access raised adoption only among households above the median income.',
  },
];

const llm = createProviders(loadEnv()).llm;
let calls = 0;
let groundingOk = 0;
let tokens = 0;
for (const action of EDIT_ACTIONS) {
  for (const selection of SELECTIONS) {
    const req = buildCommandRequest({
      command: action,
      memoryBlock: MEMORY,
      selection,
      contextBefore: '',
      contextAfter: '',
      passages: PASSAGES,
      userId: 'eval',
      documentId: 'eval',
      signal: AbortSignal.timeout(90_000),
    });
    calls += 1;
    try {
      const result = await llm.complete({ ...req, schema: commandResultSchema });
      tokens += result.usage.inputTokens + result.usage.outputTokens;
      const out = postProcessCommand(
        result.value.text,
        selection,
        action === 'counter' ? PASSAGES.map((p) => p.id) : [],
      );
      const clean = out.hallucinated.length === 0 && out.dropped.length === 0;
      if (clean) groundingOk += 1;
      console.log(
        `[${action}] ${clean ? 'grounded' : `INVENTED ${out.hallucinated.join(',')} DROPPED ${out.dropped.join(',')}`}\n  IN : ${selection}\n  OUT: ${out.text}\n`,
      );
    } catch (error) {
      console.log(`[${action}] FAIL ${String(error)}\n`);
    }
  }
}
console.log(`${groundingOk}/${calls} kept every citation and invented none; ${tokens} tokens.`);
