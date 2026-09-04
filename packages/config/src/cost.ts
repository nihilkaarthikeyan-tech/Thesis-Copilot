/**
 * Cost calculator — PRD §11.2 (unit costs) and §11.4 (monthly budget).
 *
 * Money is an integer count of micro-rupees (₹1 = 1,000,000). Never a float (PRD §0.2).
 * `computeCallCost` is what the app calls for every `AiCallLog` row, using the token counts the
 * provider actually returned — never an estimate (PRD §11.5).
 * `computeMonthlyBudget` reproduces the §11.4 table from `plans.ts` × `pricing.ts`, which is what
 * `pnpm ai:verify` (Appendix E.1 step 5) and the CI self-check (Appendix E.2) both run.
 */

import type { AiAction, MeteredAction, Tier } from './actions.js';
import { PLAN_LIMITS, type Plan } from './plans.js';
import { DEFAULT_PRICING, type Pricing, priceFor } from './pricing.js';

export const MICRO_INR_PER_INR = 1_000_000;

export function inrToMicro(inr: number): number {
  return Math.round(inr * MICRO_INR_PER_INR);
}

export function microToInr(micro: number): number {
  return micro / MICRO_INR_PER_INR;
}

/** Token counts as returned by the provider (PRD §10.2 step 5). */
export type TokenUsage = {
  /** Uncached input tokens. */
  readonly inputTokens: number;
  /** Input tokens served from the prompt cache, billed at `cacheReadMult` (PRD §10.3). */
  readonly cachedInputTokens?: number;
  /** Input tokens written to the prompt cache, billed at `cacheWriteMult` (PRD §10.3). */
  readonly cacheWriteTokens?: number;
  readonly outputTokens: number;
};

export type CallCostInput = {
  readonly tier: Tier;
  readonly modelId?: string;
  readonly usage: TokenUsage;
};

/** Cost of one LLM call in micro-INR, rounded once at the end. */
export function computeCallCost(input: CallCostInput, pricing: Pricing = DEFAULT_PRICING): number {
  const price = priceFor(pricing, input.tier, input.modelId);
  const { inputTokens, cachedInputTokens = 0, cacheWriteTokens = 0, outputTokens } = input.usage;

  const usd =
    (inputTokens * price.inputPerM +
      cachedInputTokens * price.inputPerM * price.cacheReadMult +
      cacheWriteTokens * price.inputPerM * price.cacheWriteMult +
      outputTokens * price.outputPerM) /
    1_000_000;

  return inrToMicro(usd * pricing.inrPerUsd);
}

/** Cost of embedding `tokens` tokens, in micro-INR (PRD §11.1: USD 0.02 / M). */
export function computeEmbeddingCost(tokens: number, pricing: Pricing = DEFAULT_PRICING): number {
  const usd = (tokens * pricing.embeddingPerM) / 1_000_000;
  return inrToMicro(usd * pricing.inrPerUsd);
}

/**
 * Per-call token shape for each action, copied from the "Tokens (in / cached / out)" column of
 * PRD §11.2. These drive the budget; real calls are costed from real provider usage instead.
 */
export type ActionProfile = {
  readonly tier: Tier;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
};

export const ACTION_PROFILES: Readonly<Record<MeteredAction, ActionProfile>> = {
  ASSIST: { tier: 'fast', inputTokens: 1_200, cachedInputTokens: 4_000, outputTokens: 50 },
  CITE: { tier: 'fast', inputTokens: 3_000, cachedInputTokens: 4_000, outputTokens: 100 },
  CHAT: { tier: 'fast', inputTokens: 4_000, cachedInputTokens: 4_000, outputTokens: 300 },
  DRAFT: { tier: 'strong', inputTokens: 6_000, cachedInputTokens: 4_000, outputTokens: 800 },
  COMMAND: { tier: 'strong', inputTokens: 2_000, cachedInputTokens: 4_000, outputTokens: 500 },
  COHERENCE: { tier: 'strong', inputTokens: 15_000, cachedInputTokens: 0, outputTokens: 1_500 },
};

/** One-time per-document operations, amortised over 4 months in PRD §11.4. */
export const ONE_TIME_PROFILES = {
  EXTRACT: { tier: 'strong', inputTokens: 12_000, cachedInputTokens: 0, outputTokens: 2_000 },
  OUTLINE: { tier: 'strong', inputTokens: 6_000, cachedInputTokens: 0, outputTokens: 2_000 },
  STYLE_PROFILE: { tier: 'strong', inputTokens: 3_000, cachedInputTokens: 0, outputTokens: 400 },
} as const satisfies Record<string, ActionProfile>;

/** Embedding a ~30-paper library, one time (PRD §11.2: ~300k tokens, ₹0.50). */
export const ONE_TIME_EMBED_TOKENS = 300_000;

/** PRD §11.4 amortises the one-time operations over four months. */
export const ONE_TIME_AMORTISATION_MONTHS = 4;

export type BudgetLine = {
  readonly label: string;
  /** `capped` lines are cap x unit; `fixed` lines are a single amortised or flat charge. */
  readonly kind: 'capped' | 'fixed';
  /** The plan cap for a `capped` line; 1 for a `fixed` line. */
  readonly count: number;
  /** Unit cost in micro-INR. */
  readonly unitMicroInr: number;
  /** count × unit, in micro-INR. */
  readonly totalMicroInr: number;
};

export type MonthlyBudget = {
  readonly plan: Plan;
  readonly lines: readonly BudgetLine[];
  readonly totalMicroInr: number;
  readonly totalInr: number;
  /** The ₹100/user/month ceiling from PRD §11. */
  readonly ceilingInr: number;
  readonly withinCeiling: boolean;
};

export type BudgetOptions = {
  /**
   * PRD §10.1: Draft runs on the Strong tier behind the `draftModeStrongTier` flag, falling back
   * to Fast. §11.4 gives the total for both settings (≈₹95.8 on, ≈₹79 off).
   */
  readonly draftModeStrongTier?: boolean;
  readonly pricing?: Pricing;
};

function profileCost(profile: ActionProfile, pricing: Pricing): number {
  return computeCallCost(
    {
      tier: profile.tier,
      usage: {
        inputTokens: profile.inputTokens,
        cachedInputTokens: profile.cachedInputTokens,
        outputTokens: profile.outputTokens,
      },
    },
    pricing,
  );
}

/**
 * Reproduces the PRD §11.4 table for a fully active user on `plan`, line by line and in the same
 * order, deriving every unit cost from `plans.ts` × `pricing.ts`.
 *
 * The one place this departs from a naive reading: §11.2 prices Assist at "0.15 (0.18 avg incl.
 * cache misses)" and §11.4 bills it at 0.18. A prompt cache is written once per session and read
 * many times, so the write is amortised rather than charged per call. That ~12% uplift is
 * `pricing.assistCacheMissUplift`, applied to Assist only, exactly as §11.4 does.
 */
export function computeMonthlyBudget(plan: Plan, options: BudgetOptions = {}): MonthlyBudget {
  const pricing = options.pricing ?? DEFAULT_PRICING;
  const draftStrong = options.draftModeStrongTier ?? true;
  const caps = PLAN_LIMITS[plan].caps;

  const unitFor = (action: MeteredAction): number => {
    const base = ACTION_PROFILES[action];
    const profile: ActionProfile =
      action === 'DRAFT' && !draftStrong ? { ...base, tier: 'fast' } : base;
    const cost = profileCost(profile, pricing);
    return action === 'ASSIST' ? Math.round(cost * pricing.assistCacheMissUplift) : cost;
  };

  const metered: BudgetLine[] = (
    [
      ['Assist', 'ASSIST'],
      ['Draft', 'DRAFT'],
      ['Citation suggestions', 'CITE'],
      ['Chat', 'CHAT'],
      ['Commands', 'COMMAND'],
      ['Coherence', 'COHERENCE'],
    ] as const
  ).map(([label, action]) => {
    const count = caps[action];
    const unitMicroInr = unitFor(action);
    return {
      label,
      kind: 'capped' as const,
      count,
      unitMicroInr,
      totalMicroInr: count * unitMicroInr,
    };
  });

  const oneTimeMicro =
    profileCost(ONE_TIME_PROFILES.EXTRACT, pricing) +
    profileCost(ONE_TIME_PROFILES.OUTLINE, pricing) +
    profileCost(ONE_TIME_PROFILES.STYLE_PROFILE, pricing) +
    computeEmbeddingCost(ONE_TIME_EMBED_TOKENS, pricing);

  const amortised = Math.round(oneTimeMicro / ONE_TIME_AMORTISATION_MONTHS);

  const hostingShare = inrToMicro(
    pricing.hostingInrPerMonth / pricing.assumedActiveUsersForHostingShare,
  );

  const lines: BudgetLine[] = [
    ...metered,
    {
      label: `One-time ops amortised over ${ONE_TIME_AMORTISATION_MONTHS} months`,
      kind: 'fixed',
      count: 1,
      unitMicroInr: amortised,
      totalMicroInr: amortised,
    },
    {
      label: `Hosting share (>= ${pricing.assumedActiveUsersForHostingShare} users)`,
      kind: 'fixed',
      count: 1,
      unitMicroInr: hostingShare,
      totalMicroInr: hostingShare,
    },
  ];

  const totalMicroInr = lines.reduce((sum, line) => sum + line.totalMicroInr, 0);

  return {
    plan,
    lines,
    totalMicroInr,
    totalInr: microToInr(totalMicroInr),
    ceilingInr: 100,
    withinCeiling: microToInr(totalMicroInr) <= 100,
  };
}

/** Renders the §11.4 table as text. Printed by the cost self-check and by `pnpm ai:verify`. */
export function formatBudget(budget: MonthlyBudget): string {
  const dash = (n: number): string => '-'.repeat(n);
  const rows = budget.lines.map((line) => {
    const unit = microToInr(line.unitMicroInr).toFixed(4);
    const total = microToInr(line.totalMicroInr).toFixed(2);
    const capCol = line.kind === 'fixed' ? '' : `${line.count} x ${unit}`;
    return `| ${line.label.padEnd(46)} | ${capCol.padStart(16)} | ${total.padStart(8)} |`;
  });
  const sep = `|${dash(48)}|${dash(18)}|${dash(10)}|`;
  const head = [
    `Monthly budget for a fully active ${budget.plan} user (PRD 11.4)`,
    `| ${'Item'.padEnd(46)} | ${'Cap x unit'.padStart(16)} | ${'INR'.padStart(8)} |`,
    sep,
  ];
  const foot = [
    sep,
    '| ' +
      'TOTAL'.padEnd(46) +
      ' | ' +
      ''.padStart(16) +
      ' | ' +
      budget.totalInr.toFixed(2).padStart(8) +
      ' |',
    '',
    'Ceiling: INR ' +
      budget.ceilingInr +
      '/user/month (PRD 11). ' +
      (budget.withinCeiling ? 'WITHIN' : 'EXCEEDED') +
      ' by INR ' +
      Math.abs(budget.ceilingInr - budget.totalInr).toFixed(2) +
      '.',
  ];
  return [...head, ...rows, ...foot].join('\n');
}

export type { AiAction };
