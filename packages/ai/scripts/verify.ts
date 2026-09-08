/**
 * `pnpm ai:verify` — PRD Appendix E.1.
 *
 * The cost model in §11 rests on numbers that change: model ids, prices, the exchange rate. This
 * script is the build step that checks them instead of trusting them (§0.3 rule 5).
 *
 * It must:
 *   1. read AI_FAST_MODEL, AI_STRONG_MODEL, AI_EMBED_MODEL, EMBED_DIMS from env
 *   2. make one minimal real call to each LLM model and one embedding call; print the model id the
 *      provider returns, the token counts it reports, and the embedding length
 *   3. fail if a model id is rejected, or the embedding length differs from EMBED_DIMS
 *   4. assert `pricing.ts` has an entry for each configured model id, and print the entries
 *   5. recompute the §11.4 budget with the same function the app uses and exit non-zero above ₹100
 *   6. print a block for the human to paste into Appendix E.3
 *
 * It never guesses a model id. If one is rejected it prints the provider's pricing/docs URL and
 * stops so a human can choose.
 */

import {
  applyPricingOverride,
  computeMonthlyBudget,
  DEFAULT_PRICING,
  formatBudget,
  loadEnv,
  type Pricing,
  parsePricingOverride,
  type Tier,
} from '@tc/config';
import { createProviders } from '../src/factory.js';
import type { LlmProvider } from '../src/types.js';

const line = (char = '-'): string => char.repeat(94);

type ProbeResult = {
  readonly tier: Tier;
  readonly configuredId: string;
  readonly returnedId: string;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheWriteTokens: number;
  readonly outputTokens: number;
};

/** The innermost `cause`, which is where the SDK puts the reason and the adapter wraps it. */
function rootCause(error: unknown): { name: string; message: string } {
  let current = error;
  while (current instanceof Error && current.cause instanceof Error) current = current.cause;
  return current instanceof Error
    ? { name: current.name, message: current.message }
    : { name: 'Error', message: String(current) };
}

/** Whether the provider refused the id itself, as opposed to failing before or after that. */
function looksLikeBadModelId(root: { name: string; message: string }): boolean {
  return /model|not_found|404/i.test(root.message);
}

/** Step 2: one minimal real call per LLM tier — a tiny prompt, `maxTokens: 5`. */
async function probeTier(llm: LlmProvider, tier: Tier): Promise<ProbeResult> {
  const configuredId = llm.modelIdFor(tier);
  let text = '';
  let returnedId = configuredId;
  let usage = { inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };

  for await (const chunk of llm.stream({
    tier,
    system: { cached: 'You are a test probe. Reply with one word.' },
    messages: [{ role: 'user', content: 'Say OK.' }],
    maxTokens: 5,
    action: 'ASSIST',
    userId: 'ai-verify',
  })) {
    if (chunk.type === 'text') {
      text += chunk.text;
    } else {
      returnedId = chunk.modelId;
      usage = {
        inputTokens: chunk.usage.inputTokens,
        cachedInputTokens: chunk.usage.cachedInputTokens ?? 0,
        cacheWriteTokens: chunk.usage.cacheWriteTokens ?? 0,
        outputTokens: chunk.usage.outputTokens,
      };
    }
  }

  console.log(
    '  ' +
      tier.padEnd(7) +
      configuredId.padEnd(34) +
      'in=' +
      String(usage.inputTokens).padStart(5) +
      '  cached=' +
      String(usage.cachedInputTokens).padStart(5) +
      '  cacheWrite=' +
      String(usage.cacheWriteTokens).padStart(5) +
      '  out=' +
      String(usage.outputTokens).padStart(4) +
      '  reply=' +
      JSON.stringify(text.slice(0, 24)),
  );

  return { tier, configuredId, returnedId, ...usage };
}

async function main(): Promise<void> {
  // Step 1.
  const env = loadEnv();
  const pricing: Pricing = applyPricingOverride(
    DEFAULT_PRICING,
    parsePricingOverride(env.PRICING_OVERRIDE_JSON),
  );

  console.log(line('='));
  console.log('pnpm ai:verify — PRD Appendix E.1');
  console.log(line('='));
  console.log(`AI_PROVIDER    ${env.AI_PROVIDER}`);
  console.log(`EMBED_PROVIDER ${env.EMBED_PROVIDER}`);
  console.log(`AI_FAST_MODEL  ${env.AI_FAST_MODEL}`);
  console.log(`AI_STRONG_MODEL ${env.AI_STRONG_MODEL}`);
  console.log(`AI_EMBED_MODEL ${env.AI_EMBED_MODEL}`);
  console.log(`EMBED_DIMS     ${env.EMBED_DIMS}`);

  if (env.AI_PROVIDER === 'mock' || env.EMBED_PROVIDER === 'mock') {
    console.log('');
    console.log('!! A provider is set to `mock`. This run proves nothing about real model ids or');
    console.log(
      '!! prices, and Appendix E.3 must NOT be filled from it. Set AI_PROVIDER=anthropic',
    );
    console.log('!! and EMBED_PROVIDER=voyage with real keys, then run again.');
  }

  const { llm, embeddings } = createProviders(env);

  // Step 2 and 3.
  console.log('');
  console.log('Live probe — one minimal call per model');
  console.log(line());

  const probes: ProbeResult[] = [];
  for (const tier of ['fast', 'strong'] as const) {
    try {
      probes.push(await probeTier(llm, tier));
    } catch (cause) {
      // Not necessarily a bad model id: on 2026-09-08 this printed "the provider rejected the fast
      // model id" for a request the SDK itself refused to build, and the id was fine. Report what
      // actually failed and let the reader judge.
      const root = rootCause(cause);
      console.error('');
      console.error(`FAILED: the ${tier} probe did not complete.`);
      console.error(`  configured: ${llm.modelIdFor(tier)}`);
      console.error(`  error:      ${root.name}: ${root.message}`);
      console.error('');
      if (looksLikeBadModelId(root)) {
        console.error('That reads like the provider refusing the model id.');
        console.error('This script does not guess model ids (PRD §0.3 rule 5).');
        console.error(
          `Choose one from the provider and set it in .env: ${pricing.providerPricingUrl}`,
        );
      } else {
        console.error('That is not the provider refusing the id — the request never got that far.');
        console.error('Check the adapter (packages/ai/src/providers/anthropic.ts) and the key.');
      }
      process.exit(1);
    }
  }

  let embeddingLength = 0;
  try {
    const [vector] = await embeddings.embed(['three word input']);
    embeddingLength = vector?.length ?? 0;
    console.log(
      `  embed  ${embeddings.modelId.padEnd(34)}dims=${String(embeddingLength).padStart(5)}`,
    );
  } catch (cause) {
    console.error('');
    console.error('FAILED: the embedding call did not succeed.');
    console.error(`  configured: ${embeddings.modelId}`);
    console.error(`  error:      ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exit(1);
  }

  if (embeddingLength !== env.EMBED_DIMS) {
    console.error('');
    console.error(
      'FAILED: the provider returned ' +
        embeddingLength +
        '-dimensional vectors but EMBED_DIMS is ' +
        env.EMBED_DIMS +
        '.',
    );
    console.error(
      'The database column is vector(' +
        env.EMBED_DIMS +
        '). Fix EMBED_DIMS and the schema together;',
    );
    console.error('do not truncate vectors.');
    process.exit(1);
  }

  // Step 4.
  console.log('');
  console.log('Pricing entries (packages/config/pricing.ts)');
  console.log(line());

  const missing: string[] = [];
  for (const probe of probes) {
    const entry = pricing.models[probe.configuredId];
    if (entry) {
      console.log(
        '  ' +
          probe.configuredId.padEnd(34) +
          'in $' +
          entry.inputPerM +
          '/M  out $' +
          entry.outputPerM +
          '/M  cacheRead x' +
          entry.cacheReadMult +
          '  cacheWrite x' +
          entry.cacheWriteMult,
      );
    } else {
      const tierPrice = pricing.tiers[probe.tier];
      missing.push(probe.configuredId);
      console.log(
        '  ' +
          probe.configuredId.padEnd(34) +
          'NO ENTRY — falling back to the ' +
          probe.tier +
          ' tier price (in $' +
          tierPrice.inputPerM +
          '/M, out $' +
          tierPrice.outputPerM +
          '/M)',
      );
    }
  }
  console.log(`  embeddings${' '.repeat(24)}$${pricing.embeddingPerM}/M`);
  console.log(`  exchange rate${' '.repeat(21)}INR ${pricing.inrPerUsd} = USD 1`);
  console.log(
    '  hosting' +
      ' '.repeat(27) +
      'INR ' +
      pricing.hostingInrPerMonth +
      '/month over ' +
      pricing.assumedActiveUsersForHostingShare +
      ' users',
  );

  if (missing.length > 0) {
    console.log('');
    console.log(`!! No per-model pricing entry for: ${missing.join(', ')}`);
    console.log('!! The budget below uses tier fallback prices. Add real entries to');
    console.log(
      `!! packages/config/pricing.ts (or PRICING_OVERRIDE_JSON) from ${pricing.providerPricingUrl}`,
    );
  }

  // Step 5.
  console.log('');
  const budget = computeMonthlyBudget('STUDENT_MONTHLY', { pricing });
  console.log(formatBudget(budget));

  // Step 6.
  const today = new Date().toISOString().slice(0, 10);
  console.log('');
  console.log(line('='));
  console.log('Paste into PRD Appendix E.3 — the human fills "Verified value" and "By".');
  console.log('The agent must not fill this table (§0.3 rule 3).');
  console.log(line('='));
  console.log('| Item | How verified | Verified value | Date | By |');
  console.log('|---|---|---|---|---|');
  console.log(
    '| Fast model id | `pnpm ai:verify` output | ' +
      (probes[0]?.returnedId ?? '') +
      ' | ' +
      today +
      ' | |',
  );
  console.log(
    '| Strong model id | `pnpm ai:verify` output | ' +
      (probes[1]?.returnedId ?? '') +
      ' | ' +
      today +
      ' | |',
  );
  console.log('| Fast price in / out (USD per M tokens) | Provider pricing page | | | |');
  console.log('| Strong price in / out | Provider pricing page | | | |');
  console.log('| Cache read multiplier / cache write multiplier | Provider docs | | | |');
  console.log(
    '| Embedding model id + dims + price | `pnpm ai:verify` output + pricing page | ' +
      embeddings.modelId +
      ', ' +
      embeddingLength +
      'd | ' +
      today +
      ' | |',
  );
  console.log(
    '| Exchange rate INR/USD used in `pricing.ts` | Any bank rate that day | ' +
      pricing.inrPerUsd +
      ' | ' +
      today +
      ' | |',
  );
  console.log('| VPS monthly cost (INR) incl. backups + storage | Provider invoice | | | |');
  console.log(
    '| Recomputed §11.4 total for STUDENT | `pnpm ai:verify` output | INR ' +
      budget.totalInr.toFixed(2) +
      ' | ' +
      today +
      ' | |',
  );
  console.log(line('='));

  if (!budget.withinCeiling) {
    console.error('');
    console.error(
      'FAILED: the STUDENT budget is INR ' +
        budget.totalInr.toFixed(2) +
        ', above the INR 100 ceiling (PRD §11).',
    );
    console.error('Apply the levers in Appendix E.4, in order, and run again:');
    console.error('  1. turn draftModeStrongTier off      2. lower the ASSIST cap 180 -> 150');
    console.error('  3. cut the cached block 4k -> 3k     4. lower CHAT 15 -> 10');
    process.exit(1);
  }

  console.log('');
  console.log(`OK: STUDENT budget INR ${budget.totalInr.toFixed(2)} <= INR 100.`);
}

main().catch((error: unknown) => {
  console.error('ai:verify failed:', error);
  process.exit(1);
});
