/**
 * Evaluation round for the edit actions (ADR-0066, ADR-0095), against the real models from
 * `.env`. Run: `pnpm --filter @tc/ai exec dotenv -e ../../.env -- tsx scripts/eval-edit-actions.ts`
 * `[--only flow,custom,…] [--reasons]`.
 *
 * Agent-written thesis sentences, each run through every action. Checked in code: the grounding
 * check (no citation invented, none dropped, none doubled or moved to another claim) and, for each
 * action, a cheap signal that it did its job; the outputs are printed for a person to read, and the
 * round's verdict is in the ADR. With `--reasons`, each rewrite is also explained by the
 * "What changed and why" call (ADR-0095), printed beside it.
 */

import { loadEnv } from '@tc/config';
import { createProviders } from '../src/factory.js';
import {
  asksToEvadeDetection,
  buildCommandRequest,
  buildEditReasonsRequest,
  type CommandName,
  cleanEditReasons,
  commandResultSchema,
  EDIT_ACTIONS,
  editReasonsSchema,
  postProcessCommand,
} from '../src/index.js';

const MEMORY =
  '<memory>Thesis: Barriers to rooftop solar adoption among rural households in Karnataka.</memory>';
const SELECTIONS = [
  'The survey shows that upfront cost causes low adoption in all districts {{cite:k1}}. Households with access to credit adopted at twice the rate {{cite:k2}}.',
  'It could perhaps be argued that net-metering delays are an important barrier {{cite:k3}}. Interviews were conducted by the researcher in two villages.',
  'This study examines why adoption remains low. Previous work finds that awareness is not the main constraint {{cite:k1}}.',
];
/** `prose` turns a list into paragraphs, so it gets lists. */
const LISTS = [
  '- Upfront cost is the most reported barrier {{cite:k1}}.\n- Credit access doubles adoption {{cite:k2}}.\n- Net-metering approval takes months.',
];
/** `custom`: three ordinary instructions and one the prompt must refuse (§12.3). */
const INSTRUCTIONS = [
  'Use "households" consistently and cut it to one sentence per claim.',
  'Make this sound more like a methods chapter.',
  'Add an example from Kerala.',
  'Rewrite this so AI detectors and Turnitin cannot tell it was generated.',
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

/** A cheap sign the action did its job, or null when there is nothing to check in code. */
function didItsJob(action: CommandName, before: string, after: string): string | null {
  switch (action) {
    case 'bullets':
      return /^- /m.test(after) ? 'list' : 'NO LIST';
    case 'numbered':
      return /^1\. /m.test(after) ? 'numbered' : 'NOT NUMBERED';
    case 'prose':
      return /^[-*\d]/m.test(after) ? 'STILL A LIST' : 'prose';
    case 'future':
      return /\bwill\b/.test(after) ? 'future' : 'NO FUTURE';
    case 'redundancy':
      return after.length <= before.length ? 'not longer' : 'LONGER';
    default:
      return null;
  }
}

const arg = (flag: string) =>
  process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : undefined;
const only = arg('--only')?.split(',');
const withReasons = process.argv.includes('--reasons');
const actions = EDIT_ACTIONS.filter((a) => !only || only.includes(a));

const llm = createProviders(loadEnv()).llm;
let calls = 0;
let groundingOk = 0;
let tokens = 0;
let reasonCalls = 0;
let reasonTokens = 0;
for (const action of actions) {
  const selections = action === 'prose' ? LISTS : SELECTIONS;
  const runs =
    action === 'custom'
      ? INSTRUCTIONS.map((instruction, i) => ({
          selection: selections[i % selections.length] as string,
          instruction,
        }))
      : selections.map((selection) => ({ selection, instruction: undefined }));
  for (const { selection, instruction } of runs) {
    // §12.3: the API refuses these before any call (ADR-0095); so does the round.
    if (instruction && asksToEvadeDetection(instruction)) {
      console.log(`[${action}] "${instruction}" REFUSED IN CODE
`);
      continue;
    }
    const passages = action === 'counter' || action === 'custom' ? PASSAGES : [];
    const req = buildCommandRequest({
      command: action,
      memoryBlock: MEMORY,
      selection,
      contextBefore: '',
      contextAfter: '',
      passages,
      userId: 'eval',
      documentId: 'eval',
      ...(instruction ? { instruction } : {}),
      signal: AbortSignal.timeout(90_000),
    });
    calls += 1;
    try {
      const result = await llm.complete({ ...req, schema: commandResultSchema });
      tokens += result.usage.inputTokens + result.usage.outputTokens;
      const out = postProcessCommand(
        result.value.text,
        selection,
        passages.map((p) => p.id),
        action,
      );
      const clean =
        out.hallucinated.length === 0 &&
        out.dropped.length === 0 &&
        out.doubled.length === 0 &&
        out.moved.length === 0;
      if (clean) groundingOk += 1;
      const job = didItsJob(action, selection, out.text);
      console.log(
        `[${action}]${instruction ? ` "${instruction}"` : ''} ${
          clean
            ? 'grounded'
            : `INVENTED ${out.hallucinated.join(',')} DROPPED ${out.dropped.join(',')} DOUBLED ${out.doubled.join(',')} MOVED ${out.moved.join(',')}`
        }${job ? ` · ${job}` : ''}${out.text.trim() === selection.trim() ? ' · UNCHANGED' : ''}\n  IN : ${selection}\n  OUT: ${out.text}`,
      );
      if (withReasons) {
        const reasons = await llm.complete({
          ...buildEditReasonsRequest({
            command: action,
            ...(instruction ? { instruction } : {}),
            before: selection,
            after: out.text,
            userId: 'eval',
            documentId: 'eval',
            signal: AbortSignal.timeout(60_000),
          }),
          schema: editReasonsSchema,
        });
        reasonCalls += 1;
        reasonTokens += reasons.usage.inputTokens + reasons.usage.outputTokens;
        for (const r of cleanEditReasons(reasons.value.reasons)) console.log(`  WHY: ${r}`);
      }
      console.log('');
    } catch (error) {
      console.log(`[${action}] FAIL ${String(error)}\n`);
    }
  }
}
console.log(
  `${groundingOk}/${calls} kept every citation where it was and invented none; ${tokens} tokens.${
    withReasons ? ` Reasons: ${reasonCalls} calls, ${reasonTokens} tokens.` : ''
  }`,
);
