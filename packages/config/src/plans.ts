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
  caps: { ASSIST: 180, DRAFT: 10, CITE: 30, CHAT: 15, COMMAND: 4, COHERENCE: 1, VIVA: 30 },
  seedPapers: 3,
  libraryPdfs: 60,
  pdfMaxBytes: 50 * MB,
  pdfMaxPages: 500,
  export: 'FULL',
  trialDays: null,
};

export const PLAN_LIMITS: Readonly<Record<Plan, PlanLimits>> = {
  FREE_TRIAL: {
    caps: { ASSIST: 50, DRAFT: 2, CITE: 10, CHAT: 5, COMMAND: 2, COHERENCE: 0, VIVA: 3 },
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
    caps: { ASSIST: 180, DRAFT: 10, CITE: 30, CHAT: 15, COMMAND: 4, COHERENCE: 1, VIVA: 30 },
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
