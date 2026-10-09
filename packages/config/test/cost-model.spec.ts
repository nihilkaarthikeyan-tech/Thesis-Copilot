/**
 * Cost self-check — PRD Appendix E.2. Runs on every CI run.
 *
 * "Given `plans.ts` and `pricing.ts`, compute the fully-active STUDENT budget exactly as §11.4 and
 * assert ≤ ₹100. Also assert that every `AiAction` used by any endpoint has a cap in every plan."
 */

import { describe, expect, it } from 'vitest';
import {
  AI_ACTIONS,
  type AiAction,
  isMetered,
  METERED_ACTIONS,
  PRD_METERED_ACTIONS,
  UNMETERED_ACTIONS,
} from '../src/actions.js';
import {
  ACTION_PROFILES,
  computeCallCost,
  computeEmbeddingCost,
  computeMonthlyBudget,
  formatBudget,
  LIT_REVIEW_BUILD_MAX_SECTIONS,
  microToInr,
  PRD_ACTION_PROFILES,
} from '../src/cost.js';
import { capFor, offeredOnSomePlan, PLAN_LIMITS, PLANS } from '../src/plans.js';
import { applyPricingOverride, DEFAULT_PRICING, parsePricingOverride } from '../src/pricing.js';

/**
 * The models production runs (ADR-0011: `AI_FAST_MODEL` / `AI_STRONG_MODEL` in the server's
 * `.env`). `pnpm ai:verify` checks the same ceiling against whatever is actually configured.
 */
const PRODUCTION_MODELS = { fast: 'gpt-5-nano', strong: 'gpt-5-mini' } as const;

describe('Appendix E.2 — cost self-check', () => {
  // ADR-0030, the owner's decision (2026-09-25): the PRD's own table — its six §11.3 rows at its
  // reference prices — stays within ₹100 on its own; and the whole budget, every metered action
  // included, stays within ₹100 at the models production runs. At the reference prices the six
  // rows already came to ₹98.92, so nothing could be added and still be checked there.
  it('the PRD’s own STUDENT table stays within the ₹100 ceiling at its reference prices', () => {
    const budget = computeMonthlyBudget('STUDENT_MONTHLY', {
      actions: PRD_METERED_ACTIONS,
      profiles: PRD_ACTION_PROFILES,
    });

    // Printed so the §11.4 table appears in CI output and can be pasted into the build log.
    console.log(`\n${formatBudget(budget)}\n`);

    expect(budget.withinCeiling).toBe(true);
    expect(budget.totalInr).toBeLessThanOrEqual(100);
  });

  it('the whole STUDENT budget, viva included, stays within ₹100 at the production models', () => {
    const budget = computeMonthlyBudget('STUDENT_MONTHLY', { models: PRODUCTION_MODELS });
    console.log(`\n${formatBudget(budget)}\n`);
    expect(budget.lines.map((line) => line.label)).toContain('Viva preparation');
    expect(budget.withinCeiling).toBe(true);
  });

  it('examiner reviews are priced and the whole budget still fits (ADR-0056)', () => {
    const budget = computeMonthlyBudget('STUDENT_MONTHLY', { models: PRODUCTION_MODELS });
    const line = budget.lines.find((l) => l.label === 'Examiner reviews');
    expect(line?.count).toBe(6);
    // Eight sections, each one examiner call of the chapter build's shape, on gpt-5-mini; ADR-0131
    // adds strengths and questions to the two largest (₹1.8618 → ₹2.0993).
    expect(microToInr(line?.unitMicroInr ?? 0)).toBeCloseTo(2.0993, 4);
    // ADR-0077 + ADR-0074: chat on the strong tier, researching a thin library (₹0.4850 a
    // question) took this from ₹63.89 to ₹70.73; ADR-0080's deep research adds ₹3.27; ADR-0131
    // ₹1.43 more.
    expect(budget.totalInr).toBeCloseTo(75.43, 2);
    // ADR-0051 moved the fast tier to gpt-4.1-mini for Assist; the ceiling holds there too.
    const assistModel = computeMonthlyBudget('STUDENT_MONTHLY', {
      models: { fast: 'gpt-4.1-mini', strong: PRODUCTION_MODELS.strong },
    });
    // ADR-0077 + ADR-0074: from ₹85.82; ADR-0080's three deep research questions (₹1.09 each)
    // from ₹89.85 to ₹93.13; ADR-0131's strengths and questions to ₹94.55.
    expect(assistModel.totalInr).toBeCloseTo(94.55, 2);
    expect(assistModel.withinCeiling).toBe(true);
  });

  it('literature review builds are priced per section and add nothing while the cap is 0 (ADR-0124)', () => {
    // Twenty sections at the chapter build's per-section shape: 20/14 of a chapter build.
    const unit = microToInr(
      computeCallCost({
        tier: 'strong',
        modelId: PRODUCTION_MODELS.strong,
        usage: {
          inputTokens: ACTION_PROFILES.LIT_REVIEW_BUILD.inputTokens,
          cachedInputTokens: ACTION_PROFILES.LIT_REVIEW_BUILD.cachedInputTokens,
          outputTokens: ACTION_PROFILES.LIT_REVIEW_BUILD.outputTokens,
        },
      }),
    );
    expect(unit).toBeCloseTo(12.9164, 4);
    expect(LIT_REVIEW_BUILD_MAX_SECTIONS).toBe(20);
    const chapter = microToInr(
      computeCallCost({
        tier: 'strong',
        modelId: PRODUCTION_MODELS.strong,
        usage: {
          inputTokens: ACTION_PROFILES.CHAPTER_BUILD.inputTokens,
          cachedInputTokens: ACTION_PROFILES.CHAPTER_BUILD.cachedInputTokens,
          outputTokens: ACTION_PROFILES.CHAPTER_BUILD.outputTokens,
        },
      }),
    );
    expect(unit).toBeCloseTo((chapter * 20) / 14, 2);

    for (const plan of PLANS) {
      expect(capFor(plan, 'LIT_REVIEW_BUILD'), plan).toBe(0);
      const budget = computeMonthlyBudget(plan, { models: PRODUCTION_MODELS });
      const line = budget.lines.find((l) => l.label === 'Literature review builds');
      expect(line?.count, plan).toBe(0);
      expect(line?.totalMicroInr, plan).toBe(0);
      expect(microToInr(line?.unitMicroInr ?? 0), plan).toBeCloseTo(12.9164, 4);
    }
    // Not on sale yet, so the pricing and help pages leave it off.
    expect(offeredOnSomePlan('LIT_REVIEW_BUILD')).toBe(false);
    expect(offeredOnSomePlan('CHAPTER_BUILD')).toBe(true);
    expect(offeredOnSomePlan('COHERENCE')).toBe(true);
  });

  it('STUDENT_ANNUAL and INSTITUTION_SEAT are within the ceiling too, on both bases', () => {
    for (const plan of ['STUDENT_ANNUAL', 'INSTITUTION_SEAT'] as const) {
      const prd = computeMonthlyBudget(plan, {
        actions: PRD_METERED_ACTIONS,
        profiles: PRD_ACTION_PROFILES,
      });
      expect(prd.totalInr, plan).toBeLessThanOrEqual(100);
      const production = computeMonthlyBudget(plan, { models: PRODUCTION_MODELS });
      expect(production.totalInr, plan).toBeLessThanOrEqual(100);
    }
  });

  it('viva is what the reference prices cannot carry — the reason for the two bases', () => {
    // If this ever fails, everything fits at the reference prices again and ADR-0030's split
    // can be revisited.
    expect(computeMonthlyBudget('STUDENT_MONTHLY').totalInr).toBeGreaterThan(100);
  });

  it('FREE_TRIAL costs less than a paid plan', () => {
    expect(computeMonthlyBudget('FREE_TRIAL').totalInr).toBeLessThan(
      computeMonthlyBudget('STUDENT_MONTHLY').totalInr,
    );
  });

  it('every metered action has a cap in every plan', () => {
    for (const plan of PLANS) {
      for (const action of METERED_ACTIONS) {
        const cap = PLAN_LIMITS[plan].caps[action];
        expect(cap, `${plan}.${action} has no cap`).toBeTypeOf('number');
        expect(cap, `${plan}.${action} cap is negative`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('every AiAction is classified exactly once as metered or unmetered', () => {
    const metered = new Set<AiAction>(METERED_ACTIONS);
    const unmetered = new Set<AiAction>(UNMETERED_ACTIONS);

    for (const action of AI_ACTIONS) {
      const inMetered = metered.has(action);
      const inUnmetered = unmetered.has(action);
      expect(inMetered || inUnmetered, `${action} is in neither list`).toBe(true);
      expect(inMetered && inUnmetered, `${action} is in both lists`).toBe(false);
      expect(isMetered(action)).toBe(inMetered);
    }

    expect(METERED_ACTIONS.length + UNMETERED_ACTIONS.length).toBe(AI_ACTIONS.length);
  });

  it('a missing cap reads as zero, which makes the action unusable', () => {
    // PRD Appendix E.2: "a missing cap is treated as zero and the endpoint is unusable".
    expect(capFor('FREE_TRIAL', 'COHERENCE')).toBe(0);
  });
});

describe('§11.3 — plan caps match the PRD table', () => {
  it('FREE_TRIAL', () => {
    expect(PLAN_LIMITS.FREE_TRIAL.caps).toEqual({
      ASSIST: 50,
      DRAFT: 2,
      CITE: 10,
      CHAT: 5,
      COMMAND: 2,
      COHERENCE: 0,
      // ADR-0030: not a §11.3 row.
      VIVA: 3,
      // ADR-0039: one chapter build to see what it does.
      CHAPTER_BUILD: 1,
      // ADR-0056: one examiner review to see what it does.
      EXAMINER_REVIEW: 1,
      // ADR-0080: one deep research question to see what it does.
      RESEARCH: 1,
      // ADR-0124: not on sale until the owner sets the allowance.
      LIT_REVIEW_BUILD: 0,
    });
    expect(PLAN_LIMITS.FREE_TRIAL.seedPapers).toBe(1);
    expect(PLAN_LIMITS.FREE_TRIAL.libraryPdfs).toBe(10);
    expect(PLAN_LIMITS.FREE_TRIAL.pdfMaxBytes).toBe(25 * 1024 * 1024);
    expect(PLAN_LIMITS.FREE_TRIAL.pdfMaxPages).toBe(150);
    expect(PLAN_LIMITS.FREE_TRIAL.export).toBe('BODY_ONLY');
    expect(PLAN_LIMITS.FREE_TRIAL.trialDays).toBe(14);
  });

  it('STUDENT monthly and annual share the same row', () => {
    expect(PLAN_LIMITS.STUDENT_MONTHLY).toEqual(PLAN_LIMITS.STUDENT_ANNUAL);
    expect(PLAN_LIMITS.STUDENT_MONTHLY.caps).toEqual({
      ASSIST: 180,
      DRAFT: 10,
      CITE: 30,
      CHAT: 15,
      // ADR-0008 lowered this from §11.3's 5: FR-3.6's per-section scope rewrite is metered
      // against the same cap, and each unit now buys a longer response, so five would not fit
      // under the ₹100 ceiling. The ceiling test below is what caught it.
      COMMAND: 4,
      COHERENCE: 1,
      // ADR-0030: not a §11.3 row.
      VIVA: 30,
      // ADR-0039: three planned, checked chapters a month.
      CHAPTER_BUILD: 3,
      // ADR-0056: six examiner reviews a month.
      EXAMINER_REVIEW: 6,
      // ADR-0080: three deep research questions a month (₹1.09 each).
      RESEARCH: 3,
      // ADR-0124: not on sale until the owner sets the allowance (₹12.92 a build).
      LIT_REVIEW_BUILD: 0,
    });
    expect(PLAN_LIMITS.STUDENT_MONTHLY.pdfMaxBytes).toBe(50 * 1024 * 1024);
    expect(PLAN_LIMITS.STUDENT_MONTHLY.pdfMaxPages).toBe(500);
  });

  it('INSTITUTION_SEAT matches the STUDENT caps', () => {
    expect(PLAN_LIMITS.INSTITUTION_SEAT.caps).toEqual(PLAN_LIMITS.STUDENT_MONTHLY.caps);
  });
});

describe('§11.2 — derived unit costs vs the PRD table', () => {
  /**
   * Two assertions per action.
   *
   * `derived` pins what §11.1 prices × §11.2 token counts actually produce. Any real pricing change
   * breaks this immediately — that is the guard.
   *
   * `prd` is the ₹ column the PRD prints, which is rounded. Every derived value is at or above it
   * except COHERENCE. The widest gap is CITE at +13.1% (₹0.3393 vs a stated ₹0.30), then DRAFT at
   * +8.6% (₹2.7144 vs ₹2.50). The tolerance below is therefore 15%, not 10%. This is a rounding
   * difference in the PRD, not a modelling disagreement, and it is why the real STUDENT budget
   * lands at ₹99.69 rather than the ₹95.8 §11.4 prints. Logged in docs/BUILD_LOG.md.
   */
  const PRD_TOLERANCE = 0.15;
  const cases: Array<{
    action: keyof typeof PRD_ACTION_PROFILES;
    derived: number;
    prd: number;
  }> = [
    { action: 'ASSIST', derived: 0.16095, prd: 0.15 },
    { action: 'CITE', derived: 0.3393, prd: 0.3 },
    { action: 'CHAT', derived: 0.5133, prd: 0.5 },
    { action: 'DRAFT', derived: 2.7144, prd: 2.5 },
    // ADR-0008 raised COMMAND's output allowance from 500 to 600 tokens, because FR-3.6's scope
    // rewrite draws on this cap and is the longer of the two responses. §11.2 prints ₹1.2 for the
    // 500-token version; the ADR is the authority for the number the code uses.
    { action: 'COMMAND', derived: 1.4094, prd: 1.4 },
    { action: 'COHERENCE', derived: 5.8725, prd: 6.0 },
  ];

  for (const { action, derived, prd } of cases) {
    it(`${action} derives ₹${derived} (PRD prints ₹${prd})`, () => {
      // §11.2 as printed (ADR-0077: production now runs chat on the strong tier; that is priced
      // and checked against the ceiling in the production-models tests above).
      const profile = PRD_ACTION_PROFILES[action];
      const inr = microToInr(
        computeCallCost({
          tier: profile.tier,
          usage: {
            inputTokens: profile.inputTokens,
            cachedInputTokens: profile.cachedInputTokens,
            outputTokens: profile.outputTokens,
          },
        }),
      );

      expect(inr, `${action} derived cost changed`).toBeCloseTo(derived, 4);
      expect(
        Math.abs(inr - prd) / prd,
        `${action} drifted from the PRD table: derived ₹${inr.toFixed(4)}`,
      ).toBeLessThan(PRD_TOLERANCE);
    });
  }

  it('embedding a ~30-paper library derives ₹1.566 (PRD prints ₹0.50)', () => {
    // Voyage's published price for `voyage-3` is USD 0.06/M (2026-09-25); §11.1 had 0.02, which
    // gave ₹0.522. The guard did its job: a real price change had to be written down here.
    expect(microToInr(computeEmbeddingCost(300_000))).toBeCloseTo(1.566, 4);
  });
});

describe('computeCallCost', () => {
  it('prices cached reads at 0.1× and cache writes at 1.25× the input price', () => {
    const plain = computeCallCost({ tier: 'fast', usage: { inputTokens: 1000, outputTokens: 0 } });
    const cached = computeCallCost({
      tier: 'fast',
      usage: { inputTokens: 0, cachedInputTokens: 1000, outputTokens: 0 },
    });
    const written = computeCallCost({
      tier: 'fast',
      usage: { inputTokens: 0, cacheWriteTokens: 1000, outputTokens: 0 },
    });

    expect(cached).toBe(Math.round(plain * 0.1));
    expect(written).toBe(Math.round(plain * 1.25));
  });

  it('returns an integer number of micro-rupees', () => {
    const micro = computeCallCost({
      tier: 'strong',
      usage: { inputTokens: 6000, cachedInputTokens: 4000, outputTokens: 800 },
    });
    expect(Number.isInteger(micro)).toBe(true);
  });

  it('charges nothing for an empty call', () => {
    expect(computeCallCost({ tier: 'fast', usage: { inputTokens: 0, outputTokens: 0 } })).toBe(0);
  });

  it('uses the per-model price when the model id is known', () => {
    const pricing = applyPricingOverride(DEFAULT_PRICING, {
      models: {
        'some-fast-model': {
          inputPerM: 10,
          outputPerM: 50,
          cacheReadMult: 0.1,
          cacheWriteMult: 1.25,
        },
      },
    });
    const byTier = computeCallCost(
      { tier: 'fast', usage: { inputTokens: 1000, outputTokens: 0 } },
      pricing,
    );
    const byModel = computeCallCost(
      { tier: 'fast', modelId: 'some-fast-model', usage: { inputTokens: 1000, outputTokens: 0 } },
      pricing,
    );
    expect(byModel).toBe(byTier * 10);
  });
});

describe('§11.4 — the configured model reaches every line, not just the metered ones', () => {
  // The metered lines were taught to read `options.models` when the budget was found to report the
  // same total whichever model was configured. The one-time block was missed in that pass and kept
  // pricing EXTRACT, OUTLINE and STYLE_PROFILE at the Strong *tier* fallback, so ₹2.94 of the
  // STUDENT total was independent of the configuration. It overstated rather than understated,
  // which is why nothing caught it — but a budget line that does not move when the model changes
  // is exactly the defect the ₹100 ceiling exists to notice.
  const cheap = {
    'cheap-strong': { inputPerM: 0.25, outputPerM: 2, cacheReadMult: 0.1, cacheWriteMult: 1 },
  };
  const pricing = applyPricingOverride(DEFAULT_PRICING, { models: cheap });
  const lineFor = (b: ReturnType<typeof computeMonthlyBudget>): number =>
    b.lines.find((l) => l.label.startsWith('One-time ops'))?.totalMicroInr ?? 0;

  it('prices the one-time block with the strong model, not the tier fallback', () => {
    const byTier = computeMonthlyBudget('STUDENT_MONTHLY', { pricing });
    const byModel = computeMonthlyBudget('STUDENT_MONTHLY', {
      pricing,
      models: { strong: 'cheap-strong' },
    });

    expect(lineFor(byModel)).toBeLessThan(lineFor(byTier));
  });

  it('still charges the embedding half, which has no model to vary', () => {
    // computeEmbeddingCost reads `pricing.embeddingPerM`, so the line can never reach zero.
    const byModel = computeMonthlyBudget('STUDENT_MONTHLY', {
      pricing,
      models: { strong: 'cheap-strong' },
    });
    expect(lineFor(byModel)).toBeGreaterThan(0);
  });
});

describe('§11.4 — Draft tier lever (Appendix E.4)', () => {
  it('running Draft on the Fast tier cuts the total', () => {
    const strong = computeMonthlyBudget('STUDENT_MONTHLY', { draftModeStrongTier: true });
    const fast = computeMonthlyBudget('STUDENT_MONTHLY', { draftModeStrongTier: false });

    expect(fast.totalInr).toBeLessThan(strong.totalInr);
    // §11.4: "If draftModeStrongTier is off ... Draft = 10 × 0.80 = ₹8".
    const draftLine = fast.lines.find((l) => l.label === 'Draft');
    expect(draftLine).toBeDefined();
    expect(microToInr(draftLine?.totalMicroInr ?? 0)).toBeLessThan(12);
  });
});

describe('PRICING_OVERRIDE_JSON', () => {
  it('is ignored when unset', () => {
    expect(parsePricingOverride(undefined)).toBeNull();
    expect(parsePricingOverride('')).toBeNull();
  });

  it('merges over the defaults', () => {
    const override = parsePricingOverride('{"inrPerUsd": 90}');
    const merged = applyPricingOverride(DEFAULT_PRICING, override);
    expect(merged.inrPerUsd).toBe(90);
    expect(merged.embeddingPerM).toBe(DEFAULT_PRICING.embeddingPerM);
  });

  it('throws on malformed JSON so the app refuses to start', () => {
    expect(() => parsePricingOverride('{not json')).toThrow(/not valid JSON/);
  });

  it('a worse exchange rate is caught by the ceiling assertion', () => {
    const merged = applyPricingOverride(DEFAULT_PRICING, { inrPerUsd: 200 });
    const budget = computeMonthlyBudget('STUDENT_MONTHLY', { pricing: merged });
    expect(budget.withinCeiling).toBe(false);
  });
});
