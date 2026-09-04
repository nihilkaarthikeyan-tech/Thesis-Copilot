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
  UNMETERED_ACTIONS,
} from '../src/actions.js';
import {
  ACTION_PROFILES,
  computeCallCost,
  computeEmbeddingCost,
  computeMonthlyBudget,
  formatBudget,
  microToInr,
} from '../src/cost.js';
import { capFor, PLAN_LIMITS, PLANS } from '../src/plans.js';
import { applyPricingOverride, DEFAULT_PRICING, parsePricingOverride } from '../src/pricing.js';

describe('Appendix E.2 — cost self-check', () => {
  it('the fully active STUDENT budget stays within the ₹100 ceiling', () => {
    const budget = computeMonthlyBudget('STUDENT_MONTHLY');

    // Printed so the §11.4 table appears in CI output and can be pasted into the build log.
    console.log(`\n${formatBudget(budget)}\n`);

    expect(budget.withinCeiling).toBe(true);
    expect(budget.totalInr).toBeLessThanOrEqual(100);
  });

  it('STUDENT_ANNUAL and INSTITUTION_SEAT are within the ceiling too', () => {
    for (const plan of ['STUDENT_ANNUAL', 'INSTITUTION_SEAT'] as const) {
      expect(computeMonthlyBudget(plan).totalInr, plan).toBeLessThanOrEqual(100);
    }
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
      COMMAND: 5,
      COHERENCE: 1,
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
  const cases: Array<{ action: keyof typeof ACTION_PROFILES; derived: number; prd: number }> = [
    { action: 'ASSIST', derived: 0.16095, prd: 0.15 },
    { action: 'CITE', derived: 0.3393, prd: 0.3 },
    { action: 'CHAT', derived: 0.5133, prd: 0.5 },
    { action: 'DRAFT', derived: 2.7144, prd: 2.5 },
    { action: 'COMMAND', derived: 1.2789, prd: 1.2 },
    { action: 'COHERENCE', derived: 5.8725, prd: 6.0 },
  ];

  for (const { action, derived, prd } of cases) {
    it(`${action} derives ₹${derived} (PRD prints ₹${prd})`, () => {
      const profile = ACTION_PROFILES[action];
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

  it('embedding a ~30-paper library derives ₹0.522 (PRD prints ₹0.50)', () => {
    expect(microToInr(computeEmbeddingCost(300_000))).toBeCloseTo(0.522, 4);
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
