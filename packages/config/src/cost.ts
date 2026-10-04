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

/**
 * PRD §11: ₹100 per user per month, all-in. A hard constraint, not a target.
 *
 * Two things read it. `computeMonthlyBudget` checks the *projection* — caps × modelled cost per
 * call — which is what `pnpm ai:verify` and CI enforce at build time. `UsageService` checks the
 * *actual* month-to-date spend before every metered call, which is what enforces it at runtime.
 * The projection can be wrong; the runtime check cannot.
 */
export const MONTHLY_CEILING_INR = 100;
export const MONTHLY_CEILING_MICRO_INR = MONTHLY_CEILING_INR * MICRO_INR_PER_INR;

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
  // 600 rather than §11.4's 500: FR-3.6's per-section scope rewrite is metered against this cap
  // (ADR-0008), and a scope note is the longer of the two responses. A shared cap has to be
  // priced for the more expensive thing that draws on it.
  COMMAND: { tier: 'strong', inputTokens: 2_000, cachedInputTokens: 4_000, outputTokens: 600 },
  COHERENCE: { tier: 'strong', inputTokens: 15_000, cachedInputTokens: 0, outputTokens: 1_500 },
  // ADR-0030. Priced for the larger of its two calls, a question set: about twenty passages of the
  // thesis in, eight questions out. Feedback on one answer is smaller on both sides.
  VIVA: { tier: 'strong', inputTokens: 5_000, cachedInputTokens: 1_000, outputTokens: 1_500 },
  /**
   * ADR-0039. One unit is one chapter build, priced for its worst case: 14 sections (the
   * Introduction blueprint has eleven fixed elements, plus up to three key-term groups), each
   * written once (the DRAFT shape: 6k in, 800 out) and examined once (section + evidence abstracts
   * + entities + pitfalls: 5.5k in, 600 out), half of them fixed once (2.5k in, 900 out), plus the
   * fast-tier entity extraction, which is under a paisa and folded in. The 4k cached block is
   * counted once per call (35 calls).
   */
  CHAPTER_BUILD: {
    tier: 'strong',
    // The last term is the fast-tier proofread pass over the fourteen sections (spec L6: about
    // 7,000 words at PROOFREAD_TOKENS_PER_WORD, ₹0.35 on gpt-5-nano), expressed in strong-tier
    // input tokens so one profile prices the whole build.
    inputTokens: 14 * (6_000 + 5_500) + 7 * 2_500 + 16_000,
    cachedInputTokens: 35 * 4_000,
    outputTokens: 14 * (800 + 600) + 7 * 900,
  },
  /**
   * ADR-0056. One unit is one examiner review of a chapter the student wrote, priced for its
   * worst case: `EXAMINER_REVIEW_MAX_SECTIONS` sections, each examined once with the chapter
   * build's examiner shape (section + cited passages + pitfalls: 5.5k in, 600 out, the 4k cached
   * block counted once per call). No writing, no fix, no proofread.
   */
  EXAMINER_REVIEW: {
    tier: 'strong',
    inputTokens: 8 * 5_500,
    cachedInputTokens: 8 * 4_000,
    outputTokens: 8 * 600,
  },
};

/** The most sections one examiner review sends (ADR-0056); the cost row above is priced on it. */
export const EXAMINER_REVIEW_MAX_SECTIONS = 8;

/** One-time per-document operations, amortised over 4 months in PRD §11.4. */
export const ONE_TIME_PROFILES = {
  EXTRACT: { tier: 'strong', inputTokens: 12_000, cachedInputTokens: 0, outputTokens: 2_000 },
  OUTLINE: { tier: 'strong', inputTokens: 6_000, cachedInputTokens: 0, outputTokens: 2_000 },
  STYLE_PROFILE: { tier: 'strong', inputTokens: 3_000, cachedInputTokens: 0, outputTokens: 400 },
  /**
   * FR-3.6, per-section regeneration. Smaller than a whole outline — one chapter's siblings in,
   * one scope note out — but it is a Strong call a student can ask for repeatedly, which §11.4's
   * "once per document" assumption does not cover. ADR-0008.
   */
  OUTLINE_SECTION: {
    tier: 'strong',
    inputTokens: 2_000,
    cachedInputTokens: 4_000,
    outputTokens: 600,
  },
} as const satisfies Record<string, ActionProfile>;

/**
 * The hard bound on `OUTLINE` calls for one document: the first generation plus FR-3.6
 * regenerations. `OUTLINE` carries no §11.3 cap because §11.4 treats it as once-per-document;
 * FR-3.6 makes that untrue, so the bound lives here and the budget below pays for all of them.
 */
export const OUTLINE_CALLS_PER_DOCUMENT = 12;

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
  /**
   * The model configured on each tier, so a per-model price in `pricing.models` is applied.
   *
   * Without this the budget prices purely by tier, and configuring an expensive model on the fast
   * tier changes nothing in the total — it understates by whatever the two models differ by. That
   * is the opposite of what the ₹100 ceiling is for, so `pnpm ai:verify` passes the real ids from
   * the environment and the number moves when the configuration does.
   */
  readonly models?: { readonly fast?: string; readonly strong?: string };
  /**
   * Only these metered lines. For reproducing the PRD's own §11.4 table, which prices the six
   * §11.3 rows at its reference prices (ADR-0030); omitted, every metered action is charged.
   */
  readonly actions?: readonly MeteredAction[];
};

function profileCost(
  profile: ActionProfile,
  pricing: Pricing,
  models?: BudgetOptions['models'],
): number {
  return computeCallCost(
    {
      tier: profile.tier,
      ...(models?.[profile.tier] ? { modelId: models[profile.tier] as string } : {}),
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
    const cost = profileCost(profile, pricing, options.models);
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
      ['Viva preparation', 'VIVA'],
      ['Chapter builds', 'CHAPTER_BUILD'],
      ['Examiner reviews', 'EXAMINER_REVIEW'],
    ] as const
  )
    .filter(([, action]) => !options.actions || options.actions.includes(action))
    .map(([label, action]) => {
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
    profileCost(ONE_TIME_PROFILES.EXTRACT, pricing, options.models) +
    profileCost(ONE_TIME_PROFILES.OUTLINE, pricing, options.models) +
    profileCost(ONE_TIME_PROFILES.STYLE_PROFILE, pricing, options.models) +
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
    ceilingInr: MONTHLY_CEILING_INR,
    withinCeiling: microToInr(totalMicroInr) <= MONTHLY_CEILING_INR,
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
