/**
 * Measures where `RELEVANCE_FLOOR` should sit for the configured embedding model — ADR-0032.
 *
 *   pnpm --filter @tc/ai floor
 *
 * The floor under chat (`@tc/retrieval`, `isOffTopic`) was first placed by hand on `voyage-3`:
 * four library passages, fifteen questions, and the best cosine of each question against the
 * library. The numbers went into `rank.spec.ts`; the measurement did not, so a change of model
 * had nothing to rerun. This is that measurement, kept.
 *
 * It prints each question's best cosine and the gap between the on-topic and off-topic
 * populations, and says whether the current floor sits inside it. The inputs are written for the
 * script (a library on rooftop solar, as `shakedown.ts` uses); nothing here is a fixture
 * expectation — the model's numbers are the answer, and a human reads them.
 */

import { loadEnv } from '@tc/config';
import { createProviders } from '../src/factory.js';

/** `RELEVANCE_FLOOR` in `packages/retrieval/src/rank.ts`; kept in step by hand. */
const CURRENT_FLOOR = 0.3;

const LIBRARY = [
  'Across 412 households in rural Karnataka, upfront capital cost was cited as the primary barrier to solar adoption by 68% of non-adopters, ahead of maintenance concerns (19%) and roof suitability (13%). Households with prior experience of a government subsidy scheme were 2.3 times more likely to adopt.',
  'Interviews in three Karnataka districts found that trust in installer quality, rather than price alone, determined whether a household proceeded after an initial enquiry. Respondents repeatedly cited the absence of a local service presence as the reason they did not proceed.',
  'Subsidy disbursement in the state averaged 14 weeks from application to payment over the 2018-2020 period. Installers reported that the delay, rather than the subsidy amount, was what households objected to most often.',
  'Several factors constrain household uptake of rooftop solar in rural Karnataka. Cost is the most frequently cited barrier, and it is the one policy has addressed most directly. Trust in installer quality appears to matter at least as much as price, and a household that must finance the full amount for three months is, in effect, unsubsidised.',
];

const QUESTIONS: Array<{ group: 'on' | 'gap' | 'off'; text: string }> = [
  { group: 'on', text: 'What stops rural households from installing rooftop solar?' },
  { group: 'on', text: 'How long does the subsidy take to be paid out?' },
  { group: 'on', text: 'Does trust in the installer matter more than price?' },
  { group: 'on', text: 'Which barrier did non-adopters cite most often?' },
  { group: 'on', text: 'Are households with prior subsidy experience more likely to adopt?' },
  // A fair question in the subject the library cannot answer: A.4's "try adding sources on".
  { group: 'gap', text: 'How does net metering work in India?' },
  { group: 'gap', text: 'What is the payback period of a 3 kW rooftop system?' },
  { group: 'gap', text: 'How do panel prices compare between Indian and Chinese manufacturers?' },
  { group: 'off', text: "What's the weather in Chennai today?" },
  { group: 'off', text: 'Write me a poem about the sea.' },
  { group: 'off', text: 'Who won the 2023 cricket world cup?' },
  { group: 'off', text: 'How do I make biryani?' },
  { group: 'off', text: 'Explain how a transformer neural network works.' },
  { group: 'off', text: 'What is the capital of Australia?' },
  { group: 'off', text: 'Give me tips for a job interview.' },
];

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as number;
    const y = b[i] as number;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function main(): Promise<void> {
  const env = loadEnv();
  if (env.EMBED_PROVIDER === 'mock') throw new Error('EMBED_PROVIDER is mock: nothing to measure.');
  const { embeddings } = createProviders(env);
  console.log(`Model: ${embeddings.modelId}\n`);

  const library = await embeddings.embed(LIBRARY);
  const asked = await embeddings.embed(QUESTIONS.map((q) => q.text));
  const best = QUESTIONS.map((q, i) => ({
    ...q,
    cosine: Math.max(...library.map((vector) => cosine(asked[i] as number[], vector))),
  }));

  for (const group of ['on', 'gap', 'off'] as const) {
    console.log(
      {
        on: 'On topic, must be answered',
        gap: 'In the subject, library has nothing',
        off: 'Off topic, must be refused',
      }[group],
    );
    for (const q of best.filter((b) => b.group === group).sort((a, b) => b.cosine - a.cosine)) {
      console.log(`  ${q.cosine.toFixed(3)}  ${q.text}`);
    }
  }

  const lowestAnswered = Math.min(...best.filter((b) => b.group !== 'off').map((b) => b.cosine));
  const highestRefused = Math.max(...best.filter((b) => b.group === 'off').map((b) => b.cosine));
  console.log(`\nLowest that must pass:   ${lowestAnswered.toFixed(3)}`);
  console.log(`Highest that must fail:  ${highestRefused.toFixed(3)}`);
  const inside = CURRENT_FLOOR > highestRefused && CURRENT_FLOOR < lowestAnswered;
  console.log(
    `Current floor ${CURRENT_FLOOR}: ${inside ? 'inside the gap — keep it' : 'NOT inside the gap — move it and update rank.spec.ts'}`,
  );
  if (lowestAnswered <= highestRefused)
    console.log('The populations overlap: no floor separates them.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
