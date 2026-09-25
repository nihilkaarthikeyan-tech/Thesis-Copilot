/**
 * Model prices and cost-model assumptions — PRD §11.1.
 *
 * EVERY NUMBER HERE IS UNVERIFIED until a human fills PRD Appendix E.3 (§0.3 rule 5).
 * `pnpm ai:verify` re-derives the budget from these values and exits non-zero if it exceeds ₹100.
 * All values are overridable at runtime via `PRICING_OVERRIDE_JSON` so a price change does not
 * need a deploy.
 */

import type { Tier } from './actions.js';

/** USD per million tokens, plus the cache multipliers applied to the input price (PRD §11.1). */
export type ModelPrice = {
  readonly inputPerM: number;
  readonly outputPerM: number;
  /** Cached-block read price as a multiple of `inputPerM` (PRD §11.1: 0.1 × input). */
  readonly cacheReadMult: number;
  /** Cached-block write price as a multiple of `inputPerM` (PRD §11.1: 1.25 × input). */
  readonly cacheWriteMult: number;
};

export type Pricing = {
  /** Keyed by the model id in `AI_FAST_MODEL` / `AI_STRONG_MODEL`. Filled after `pnpm ai:verify`. */
  readonly models: Readonly<Record<string, ModelPrice>>;
  /** Fallback price per tier, used for the budget before real model ids are verified. */
  readonly tiers: Readonly<Record<Tier, ModelPrice>>;
  /** USD per million embedding tokens (PRD §11.1: USD 0.02 / M). */
  readonly embeddingPerM: number;
  /** ₹ per USD (PRD §11.1: ₹87 = USD 1). */
  readonly inrPerUsd: number;
  /** Whole-VPS monthly cost in ₹, including backups and object storage (PRD §11.1: ₹3,500). */
  readonly hostingInrPerMonth: number;
  /** Denominator for the per-user hosting share (PRD §11.1: ₹7 at 500 users). */
  readonly assumedActiveUsersForHostingShare: number;
  /**
   * Multiplier on cached-block reads for Assist that accounts for paying the cache write once per
   * session rather than once per call. PRD §11.2 states Assist as "0.15 (0.18 avg incl. cache
   * misses)", a ~12% uplift; this reproduces that line. See `cost.ts` for where it is applied.
   */
  readonly assistCacheMissUplift: number;
  /** Provider docs, printed by `pnpm ai:verify` when a model id cannot be confirmed (Appendix E.1). */
  readonly providerPricingUrl: string;
};

/** PRD §11.1: Fast USD 1 / 5 per M in/out; Strong USD 3 / 15; cache read 0.1×, cache write 1.25×. */
const FAST: ModelPrice = { inputPerM: 1, outputPerM: 5, cacheReadMult: 0.1, cacheWriteMult: 1.25 };
const STRONG: ModelPrice = {
  inputPerM: 3,
  outputPerM: 15,
  cacheReadMult: 0.1,
  cacheWriteMult: 1.25,
};

/**
 * Per-model prices, which override the tier price for that id.
 *
 * This exists because a model can be configured on either tier. `claude-sonnet-5` is priced at
 * §11.1's Strong rate wherever it is used — putting it on the fast tier does not make it cheap,
 * and pricing it as if it were is how a budget silently understates itself by 3×.
 *
 * §0.3 rule 4 still applies: these are the PRD's own stated rates, not a guess at the provider's.
 * `pnpm ai:verify` prints them next to the provider's pricing page for a human to confirm.
 */
const SONNET_5: ModelPrice = {
  // Verified against platform.claude.com/docs/en/about-claude/pricing on 2026-09-13. The page
  // carries an explicit note that the scheduled rise to $3/$15 on 2026-09-01 did not happen, so
  // the introductory rate is now standard. The `STRONG` tier fallback stays at $3/$15 because it
  // prices an *unverified* model, where guessing high is the safe direction.
  inputPerM: 2,
  outputPerM: 10,
  cacheReadMult: 0.1,
  cacheWriteMult: 1.25,
};

/**
 * OpenAI models (ADR-0011), read from developers.openai.com/api/docs/pricing on 2026-09-13.
 *
 * OpenAI publishes a cached-input *price* where Anthropic publishes a multiplier, so each entry
 * carries the ratio of the two published figures. `computeCallCost` needs no change: 0.005/0.05 is
 * 0.1 for `gpt-5-nano`, the same shape it already applies.
 *
 * `cacheWriteMult` is 1 throughout because OpenAI does not charge to populate its cache — it
 * caches prefixes over ~1,024 tokens automatically, with no write step to bill.
 */
const OPENAI: Record<string, ModelPrice> = {
  'gpt-5-nano': { inputPerM: 0.05, outputPerM: 0.4, cacheReadMult: 0.1, cacheWriteMult: 1 },
  'gpt-4.1-nano': { inputPerM: 0.1, outputPerM: 0.4, cacheReadMult: 0.25, cacheWriteMult: 1 },
  'gpt-4o-mini': { inputPerM: 0.15, outputPerM: 0.6, cacheReadMult: 0.5, cacheWriteMult: 1 },
  'gpt-5-mini': { inputPerM: 0.25, outputPerM: 2.0, cacheReadMult: 0.1, cacheWriteMult: 1 },
  'gpt-5.4-nano': { inputPerM: 0.2, outputPerM: 1.25, cacheReadMult: 0.1, cacheWriteMult: 1 },
  'gpt-5.4-mini': { inputPerM: 0.75, outputPerM: 4.5, cacheReadMult: 0.1, cacheWriteMult: 1 },
};

const MODEL_PRICES: Record<string, ModelPrice> = {
  ...OPENAI,
  'claude-sonnet-5': SONNET_5,
  // Symmetrically: Haiku stays at the Fast rate even if it is configured on the strong tier.
  // Without both entries the fallback is the *tier* price, which prices whichever model is there
  // as though it were the one the tier was designed around — wrong in both directions.
  'claude-haiku-4-5-20251001': FAST,
};

export const DEFAULT_PRICING: Pricing = {
  models: MODEL_PRICES,
  tiers: { fast: FAST, strong: STRONG },
  // `voyage-4` (ADR-0032), read off docs.voyageai.com/docs/pricing on 2026-09-25: USD 0.06 per
  // million tokens, the first 200M free per account. `voyage-3`, which PRD §11.1 priced at 0.02,
  // now lists at the same 0.06 with no free tokens.
  embeddingPerM: 0.06,
  inrPerUsd: 87,
  hostingInrPerMonth: 3500,
  assumedActiveUsersForHostingShare: 500,
  assistCacheMissUplift: 1.12,
  providerPricingUrl: 'https://docs.claude.com/en/docs/about-claude/pricing',
};

/** Shape accepted in `PRICING_OVERRIDE_JSON`. Every field is optional and merges over the default. */
export type PricingOverride = Partial<Omit<Pricing, 'models' | 'tiers'>> & {
  models?: Record<string, ModelPrice>;
  tiers?: Partial<Record<Tier, ModelPrice>>;
};

export function applyPricingOverride(base: Pricing, override: PricingOverride | null): Pricing {
  if (!override) return base;
  return {
    ...base,
    ...override,
    models: { ...base.models, ...(override.models ?? {}) },
    tiers: { ...base.tiers, ...(override.tiers ?? {}) },
  };
}

/** Parses `PRICING_OVERRIDE_JSON`. Throws on malformed JSON so the app refuses to start (§0.2). */
export function parsePricingOverride(raw: string | undefined): PricingOverride | null {
  if (!raw || raw.trim() === '') return null;
  try {
    return JSON.parse(raw) as PricingOverride;
  } catch (cause) {
    throw new Error(
      `PRICING_OVERRIDE_JSON is not valid JSON. Fix it or unset it. Original error: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
  }
}

/**
 * Price for a model id, falling back to its tier price when the id is not in the table.
 * `pnpm ai:verify` asserts an entry exists for each configured id (Appendix E.1 step 4), so the
 * fallback only applies before verification.
 */
export function priceFor(pricing: Pricing, tier: Tier, modelId?: string): ModelPrice {
  if (modelId && pricing.models[modelId]) return pricing.models[modelId];
  return pricing.tiers[tier];
}
