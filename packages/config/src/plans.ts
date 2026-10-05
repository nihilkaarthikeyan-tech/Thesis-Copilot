/**
 * Plan caps — PRD §11.3, copied exactly.
 *
 * Caps are per user per calendar month and reset at 00:00 UTC on the 1st (PRD §0.2, §11.5).
 * A missing cap is treated as zero, which makes the endpoint unusable — intentional, and it fails
 * loudly (PRD Appendix E.2).
 */

import { METERED_ACTIONS, type MeteredAction } from './actions.js';

export const PLANS = [
  'FREE_TRIAL',
  'STUDENT_MONTHLY',
  'STUDENT_ANNUAL',
  'INSTITUTION_SEAT',
] as const;
export type Plan = (typeof PLANS)[number];

export type PlanLimits = {
  /** Per-month cap for each metered AI action (PRD §11.3). */
  readonly caps: Readonly<Record<MeteredAction, number>>;
  /** Seed papers the student may upload for Path B (PRD §11.3). */
  readonly seedPapers: number;
  /** PDFs the student may add to the library (PRD §11.3). */
  readonly libraryPdfs: number;
  /** Upload limits (PRD §11.3). Enforced per plan on every upload (§12.1). */
  readonly pdfMaxBytes: number;
  readonly pdfMaxPages: number;
  /** `.docx` export scope (PRD §11.3). BODY_ONLY omits the bibliography and front matter. */
  readonly export: 'BODY_ONLY' | 'FULL';
  /** Trial length in days, or null for a paid plan (PRD §11.3 header). */
  readonly trialDays: number | null;
};

const MB = 1024 * 1024;

/** STUDENT_MONTHLY and STUDENT_ANNUAL share one row in §11.3 ("STUDENT (monthly/annual)"). */
const STUDENT: PlanLimits = {
  caps: {
    ASSIST: 180,
    DRAFT: 10,
    CITE: 30,
    CHAT: 15,
    COMMAND: 4,
    COHERENCE: 1,
    VIVA: 30,
    CHAPTER_BUILD: 3,
    EXAMINER_REVIEW: 6,
  },
  seedPapers: 3,
  libraryPdfs: 60,
  pdfMaxBytes: 50 * MB,
  pdfMaxPages: 500,
  export: 'FULL',
  trialDays: null,
};

export const PLAN_LIMITS: Readonly<Record<Plan, PlanLimits>> = {
  FREE_TRIAL: {
    caps: {
      ASSIST: 50,
      DRAFT: 2,
      CITE: 10,
      CHAT: 5,
      COMMAND: 2,
      COHERENCE: 0,
      VIVA: 3,
      CHAPTER_BUILD: 1,
      EXAMINER_REVIEW: 1,
    },
    seedPapers: 1,
    libraryPdfs: 10,
    pdfMaxBytes: 25 * MB,
    pdfMaxPages: 150,
    export: 'BODY_ONLY',
    trialDays: 14,
  },
  STUDENT_MONTHLY: STUDENT,
  STUDENT_ANNUAL: STUDENT,
  INSTITUTION_SEAT: {
    caps: {
      ASSIST: 180,
      DRAFT: 10,
      CITE: 30,
      CHAT: 15,
      COMMAND: 4,
      COHERENCE: 1,
      VIVA: 30,
      CHAPTER_BUILD: 3,
      EXAMINER_REVIEW: 6,
    },
    seedPapers: 3,
    libraryPdfs: 60,
    pdfMaxBytes: 50 * MB,
    pdfMaxPages: 500,
    export: 'FULL',
    trialDays: null,
  },
};

/** Cap for one action on one plan. Absent means zero — the endpoint is unusable (Appendix E.2). */
export function capFor(plan: Plan, action: MeteredAction): number {
  return PLAN_LIMITS[plan].caps[action] ?? 0;
}

export { METERED_ACTIONS, type MeteredAction };

/**
 * Finding sources on its own (ADR-0037, 2026-09-30): when nothing in the library covers the
 * section being written, the system searches the indexes and adds a few papers.
 *
 * Bounded twice. `perRun` papers at most per search, and `monthly` searches per plan; each search
 * reads at most ~90k embedding tokens (candidate abstracts plus the full text of what it adds), a
 * worst case under ₹0.50 at voyage-4's price, so 20 a month is at most ~₹9 against the ₹100
 * ceiling. `minCosine` is chat's measured relevance floor (`RELEVANCE_FLOOR`): below it a paper is
 * not about what the student is writing, and adding it would only put an off-topic citation in
 * reach. `cooldownMinutes` stops one chapter searching again while the last search is still
 * being read.
 */
export const AUTO_SOURCES = {
  perRun: 5,
  /** Library passages at or above this count as covering the text (chat's `RELEVANCE_FLOOR`). */
  minCosine: 0.3,
  /**
   * A found paper is added only at or above this against the thesis-and-section query. Measured
   * 2026-09-30 on the real indexes with voyage-4: on-topic papers for two theses scored 0.67–0.80;
   * the wrong-field papers a weak query let in (battery, supercapacitor and wastewater electrodes
   * for an EDM thesis) scored 0.46–0.61. Adding nothing is better than adding the wrong field.
   */
  addCosine: 0.6,
  cooldownMinutes: 10,
  monthly: {
    FREE_TRIAL: 5,
    STUDENT_MONTHLY: 20,
    STUDENT_ANNUAL: 20,
    INSTITUTION_SEAT: 20,
  } satisfies Record<Plan, number>,
} as const;

/** This plan's automatic searches per month (ADR-0037). An unknown plan gets the trial's. */
export function monthlyAutoSearches(plan: string): number {
  return (PLANS as readonly string[]).includes(plan)
    ? AUTO_SOURCES.monthly[plan as Plan]
    : AUTO_SOURCES.monthly.FREE_TRIAL;
}

/**
 * The job id for a chapter's automatic search: one per chapter per cooldown window, so repeated
 * requests while the last search is still being read are the same job, which BullMQ ignores.
 * Keyed on the chapter (what the search reads), and free of ':', which job ids cannot contain.
 */
export function autoSourcesJobKey(chapterId: string, now: Date = new Date()): string {
  const window = Math.floor(now.getTime() / (AUTO_SOURCES.cooldownMinutes * 60_000));
  return `find-sources-${chapterId}-${window}`;
}

/**
 * Chapters planned from the thesis title (ADR-0072): when a thesis is started with "Start writing
 * now", or when the student presses "Plan my chapters from the title". One A.9 outline call each
 * (`OUTLINE`, Strong; ₹0.48 as profiled, ₹0.68 measured on `gpt-5-mini` on 2026-10-05, whose
 * reasoning tokens took the output to 3,791). `OUTLINE` has no §11.3 cap — §11.4 prices it once
 * per thesis in the one-time line — so what bounds it here is a count per month: a student who
 * starts a sixth thesis in one month still gets one, only planned by hand from the Outline page.
 * Worst case beyond the one-time line, at the measured price: 4 × ₹0.68 = ₹2.72 a month on a
 * paid plan, ₹0.68 on the trial. Counted from the `OUTLINE_FROM_TITLE` audit events.
 */
export const AUTO_OUTLINES = {
  monthly: {
    FREE_TRIAL: 2,
    STUDENT_MONTHLY: 5,
    STUDENT_ANNUAL: 5,
    INSTITUTION_SEAT: 5,
  } satisfies Record<Plan, number>,
} as const;

/** This plan's title-planned outlines per month (ADR-0072). An unknown plan gets the trial's. */
export function monthlyAutoOutlines(plan: string): number {
  return (PLANS as readonly string[]).includes(plan)
    ? AUTO_OUTLINES.monthly[plan as Plan]
    : AUTO_OUTLINES.monthly.FREE_TRIAL;
}

/** The feature switch that turns automatic sources on for the whole site (ADR-0037). */
export const AUTO_SOURCES_FLAG = 'autoSources';
