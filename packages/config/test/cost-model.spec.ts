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
  PROOFREAD_WORDS_PER_UNIT,
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
  PROJECTION_LIMIT_INR,
} from '../src/cost.js';
import {
  CALLS_PER_KEPT,
  callCeiling,
  capFor,
  countsKept,
  offeredOnSomePlan,
  PLAN_LIMITS,
  PLANS,
} from '../src/plans.js';
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
  it('the PRD’s own STUDENT table, at its reference prices, is inside the projection limit', () => {
    const budget = computeMonthlyBudget('STUDENT_MONTHLY', {
      actions: PRD_METERED_ACTIONS,
      profiles: PRD_ACTION_PROFILES,
      // ADR-0144: §11.4 prints one call per unit.
      callCeilings: false,
    });

    // Printed so the §11.4 table appears in CI output and can be pasted into the build log.
    console.log(`\n${formatBudget(budget)}\n`);

    // ADR-0152 (Option B, the owner, 2026-10-10): forty section commands a month, at §11.2's
    // reference ₹1.41 a command, take the six rows to ₹149.92. Over ₹100 on paper,
    // as ADR-0143 accepted for the production budget; the runtime stop holds real spend at ₹100.
    expect(budget.totalInr).toBeCloseTo(149.92, 2);
    expect(budget.withinCeiling).toBe(false);
    expect(budget.withinProjectionLimit).toBe(true);
  });

  it('the whole STUDENT budget, viva included, with gpt-5-nano on the fast tier (ADR-0152)', () => {
    const budget = computeMonthlyBudget('STUDENT_MONTHLY', { models: PRODUCTION_MODELS });
    console.log(`\n${formatBudget(budget)}\n`);
    expect(budget.lines.map((line) => line.label)).toContain('Viva preparation');
    // ADR-0152: ₹96.32 → ₹104.93 (36 more commands ₹5.64, 30 proofreading runs ₹2.98).
    expect(budget.withinCeiling).toBe(false);
    expect(budget.withinProjectionLimit).toBe(true);
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
    // ₹1.43 more; ADR-0143's one literature review a month ₹17.39 (to ₹92.81); ADR-0144's Assist
    // call ceiling, three calls per kept suggestion, ₹3.51 more; ADR-0152's forty commands and
    // thirty proofreading runs ₹8.61 more.
    expect(budget.totalInr).toBeCloseTo(104.93, 2);
    // ADR-0051 moved the fast tier to gpt-4.1-mini, which is what production runs.
    const assistModel = computeMonthlyBudget('STUDENT_MONTHLY', {
      models: { fast: 'gpt-4.1-mini', strong: PRODUCTION_MODELS.strong },
    });
    // ADR-0077 + ADR-0074: from ₹85.82; ADR-0080's three deep research questions (₹1.09 each)
    // from ₹89.85 to ₹93.13; ADR-0131's strengths and questions to ₹94.55; ADR-0143's one
    // literature review a month (₹17.39) to ₹111.94 — over ₹100, which the owner accepted (2026-10-09);
    // ADR-0144's call ceiling (540 Assist calls for 180 kept) to ₹145.62; ADR-0152's forty
    // commands (₹5.64 more) and thirty proofreading runs at ₹0.48 (₹14.53) to ₹165.79.
    // The runtime stop still holds real spend at ₹100; the projection must stay under its limit.
    expect(assistModel.totalInr).toBeCloseTo(165.79, 2);
    expect(assistModel.withinCeiling).toBe(false);
    expect(assistModel.withinProjectionLimit).toBe(true);
    expect(assistModel.projectionLimitInr).toBe(PROJECTION_LIMIT_INR);
  });

  it('literature review builds are priced per section, one a month on a paid plan (ADR-0124, ADR-0143)', () => {
    // Twenty sections: drafts, examiner readings, ten fixes and the fast-tier calls.
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
    // ADR-0143: repriced from the first real review (ten sections, ₹8.63 on 2026-10-09).
    expect(unit).toBeCloseTo(17.3878, 4);
    // Twenty sections must cost no less than twice the measured ten.
    expect(unit).toBeGreaterThanOrEqual(2 * 8.63);
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
    // Never below the chapter build's per-section price it was first derived from (ADR-0124).
    expect(unit).toBeGreaterThan((chapter * 20) / 14);

    for (const plan of PLANS) {
      const allowance = plan === 'FREE_TRIAL' ? 0 : 1;
      expect(capFor(plan, 'LIT_REVIEW_BUILD'), plan).toBe(allowance);
      const budget = computeMonthlyBudget(plan, { models: PRODUCTION_MODELS });
      const line = budget.lines.find((l) => l.label === 'Literature review builds');
      expect(line?.count, plan).toBe(allowance);
      expect(microToInr(line?.totalMicroInr ?? 0), plan).toBeCloseTo(allowance * 17.3878, 4);
      expect(microToInr(line?.unitMicroInr ?? 0), plan).toBeCloseTo(17.3878, 4);
    }
    // On sale now, so the pricing and help pages list it.
    expect(offeredOnSomePlan('LIT_REVIEW_BUILD')).toBe(true);
    expect(offeredOnSomePlan('CHAPTER_BUILD')).toBe(true);
    expect(offeredOnSomePlan('COHERENCE')).toBe(true);
  });

  it('STUDENT_ANNUAL and INSTITUTION_SEAT are within the ceiling too, on both bases', () => {
    for (const plan of ['STUDENT_ANNUAL', 'INSTITUTION_SEAT'] as const) {
      const prd = computeMonthlyBudget(plan, {
        actions: PRD_METERED_ACTIONS,
        profiles: PRD_ACTION_PROFILES,
        // ADR-0144: §11.4 prints one call per unit.
        callCeilings: false,
      });
      // ADR-0152: over ₹100 on paper (forty commands), inside the projection limit.
      expect(prd.withinProjectionLimit, plan).toBe(true);
      const production = computeMonthlyBudget(plan, { models: PRODUCTION_MODELS });
      expect(production.withinProjectionLimit, plan).toBe(true);
      // ADR-0143: at the fast tier production runs, over ₹100 but inside the projection limit.
      const live = computeMonthlyBudget(plan, {
        models: { fast: 'gpt-4.1-mini', strong: PRODUCTION_MODELS.strong },
      });
      expect(live.withinProjectionLimit, plan).toBe(true);
    }
  });

  it('Assist is priced at its call ceiling, three calls per kept suggestion (ADR-0144)', () => {
    expect(CALLS_PER_KEPT).toEqual({ ASSIST: 3 });
    expect(countsKept('ASSIST')).toBe(true);
    expect(countsKept('DRAFT')).toBe(false);
    expect(callCeiling('ASSIST', 180)).toBe(540);
    expect(callCeiling('DRAFT', 10)).toBe(10);
    for (const plan of PLANS) {
      const line = computeMonthlyBudget(plan).lines[0];
      expect(line?.count, plan).toBe(PLAN_LIMITS[plan].caps.ASSIST * 3);
      const printed = computeMonthlyBudget(plan, { callCeilings: false }).lines[0];
      expect(printed?.count, plan).toBe(PLAN_LIMITS[plan].caps.ASSIST);
      expect(printed?.label, plan).toBe('Assist');
    }
    // The trial at the production fast tier: ₹30.55 → ₹39.90 (ADR-0144) → ₹50.23 (ADR-0152).
    const trial = computeMonthlyBudget('FREE_TRIAL', {
      models: { fast: 'gpt-4.1-mini', strong: PRODUCTION_MODELS.strong },
    });
    expect(trial.totalInr).toBeCloseTo(50.23, 2);
    expect(trial.withinCeiling).toBe(true);
  });

  it('proofreading is its own allowance, priced at 2,000 words a run (ADR-0152)', () => {
    expect(isMetered('PROOFREAD')).toBe(true);
    expect(PROOFREAD_WORDS_PER_UNIT).toBe(2_000);
    expect(ACTION_PROFILES.PROOFREAD).toEqual({
      tier: 'fast',
      inputTokens: 5_040,
      cachedInputTokens: 0,
      outputTokens: 2_220,
    });
    expect(capFor('FREE_TRIAL', 'PROOFREAD')).toBe(10);
    for (const plan of ['STUDENT_MONTHLY', 'STUDENT_ANNUAL', 'INSTITUTION_SEAT'] as const) {
      expect(capFor(plan, 'PROOFREAD'), plan).toBe(30);
    }
    const live = { fast: 'gpt-4.1-mini', strong: PRODUCTION_MODELS.strong };
    for (const [plan, runs] of [
      ['FREE_TRIAL', 10],
      ['STUDENT_MONTHLY', 30],
    ] as const) {
      const line = computeMonthlyBudget(plan, { models: live }).lines.find(
        (l) => l.label === 'Proofreading',
      );
      expect(line?.count, plan).toBe(runs);
      // 5,040 in and 2,220 out on gpt-4.1-mini: ₹0.4844 a run.
      expect(microToInr(line?.unitMicroInr ?? 0), plan).toBeCloseTo(0.4844, 4);
    }
    // Option B's figure for a paid student, every allowance used in full.
    expect(computeMonthlyBudget('STUDENT_MONTHLY', { models: live }).totalInr).toBeCloseTo(
      165.79,
      2,
    );
  });

  it('a runaway configuration still fails the projection limit (ADR-0143)', () => {
    // Prices ten times what is configured (a wrong rate, a wrong model id) is a mistake, not a
    // decision, and must still fail.
    const pricing = applyPricingOverride(DEFAULT_PRICING, { inrPerUsd: 87 * 10 });
    const budget = computeMonthlyBudget('STUDENT_MONTHLY', {
      pricing,
      models: { fast: 'gpt-4.1-mini', strong: PRODUCTION_MODELS.strong },
    });
    expect(budget.withinProjectionLimit).toBe(false);
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
      // ADR-0152 (Option B): drafts 2 → 3, citations 10 → 20, questions 5 → 10, commands 2 → 10.
      DRAFT: 3,
      CITE: 20,
      CHAT: 10,
      COMMAND: 10,
      COHERENCE: 0,
      // ADR-0030: not a §11.3 row.
      VIVA: 3,
      // ADR-0039: one chapter build to see what it does.
      CHAPTER_BUILD: 1,
      // ADR-0056: one examiner review to see what it does.
      EXAMINER_REVIEW: 1,
      // ADR-0080: one deep research question to see what it does.
      RESEARCH: 1,
      // ADR-0124; ADR-0143 keeps it off the trial.
      LIT_REVIEW_BUILD: 0,
      // ADR-0152: ten proofreading runs of 2,000 words over the trial.
      PROOFREAD: 10,
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
      // ADR-0152 (Option B, the owner, 2026-10-10): 4 → 40, the projection over ₹100 accepted.
      COMMAND: 40,
      COHERENCE: 1,
      // ADR-0030: not a §11.3 row.
      VIVA: 30,
      // ADR-0039: three planned, checked chapters a month.
      CHAPTER_BUILD: 3,
      // ADR-0056: six examiner reviews a month.
      EXAMINER_REVIEW: 6,
      // ADR-0080: three deep research questions a month (₹1.09 each).
      RESEARCH: 3,
      // ADR-0124, ADR-0143: one whole literature review a month (₹17.39 a build).
      LIT_REVIEW_BUILD: 1,
      // ADR-0152: thirty proofreading runs of 2,000 words (60,000 words) a month.
      PROOFREAD: 30,
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
