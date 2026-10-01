/**
 * Chapter build — ADR-0039. The plan a build works from, the issues its checks raise, and the QA
 * report it delivers. Shared by the worker (which writes them), the API (which serves them) and
 * the web (which shows them), so one schema is the shape everywhere.
 */

import { z } from 'zod';

/** What the student chose for this thesis on the build screen; kept on `Document.meta`. */
export const chapterProfileSchema = z.object({
  disciplineId: z.string().trim().min(1),
  paradigm: z.string().trim().min(1),
  universityId: z.string().trim().min(1),
  /** IETF tag; defaults to the document's language. */
  language: z.string().trim().min(1).optional(),
  /** Blueprint element keys the student turned off ("most" elements only). */
  disabledElements: z.array(z.string()).optional(),
});
export type ChapterProfile = z.infer<typeof chapterProfileSchema>;

/** A key term from the objectives (spec §2.2), typed by the discipline profile. */
export const buildEntitySchema = z.object({
  id: z.string(),
  text: z.string(),
  type: z.string(),
  aliases: z.array(z.string()),
  /** 1-based index of the objective it came from; 0 when it came from the title or questions. */
  sourceObjective: z.number().int().min(0),
  /** Section ids (plan order) that introduce it, filled by the coverage step. */
  coveredBy: z.array(z.string()),
  /** The model gave a type the profile does not have, so the first type stands in (ask about it). */
  typeUnknown: z.boolean().optional(),
});
export type BuildEntity = z.infer<typeof buildEntitySchema>;

export const planSectionSchema = z.object({
  /** Stable within the plan: `s1`, `s2`, … in chapter order. */
  id: z.string(),
  title: z.string(),
  blueprintRef: z.string(),
  purpose: z.string(),
  instructions: z.string(),
  /** Entities this section must introduce. */
  entities: z.array(z.string()),
  targetWords: z.number().int().positive(),
  isObjectives: z.boolean(),
  generic: z.boolean(),
  organisation: z.boolean(),
  summary: z.boolean(),
  dataOnly: z.boolean(),
  /** Written from the thesis's own memory; attempted even with no passage (objectives, summaries). */
  noEvidence: z.boolean(),
  /** The existing outline node this section maps to, when the outline already had it. */
  outlineNodeId: z.string().nullable(),
});
export type PlanSection = z.infer<typeof planSectionSchema>;

/**
 * Spec stage 1: one clarifying question per ambiguous term, asked in code before the build and
 * answered by the student on the plan screen. The answer becomes an alias of the term and a line
 * in the section's scope note.
 */
export const clarificationSchema = z.object({
  id: z.string(),
  entityId: z.string().nullable(),
  kind: z.enum(['abbreviation', 'meaning', 'scope']),
  question: z.string(),
  answer: z.string().nullable(),
});
export type Clarification = z.infer<typeof clarificationSchema>;

export const chapterBuildPlanSchema = z.object({
  chapterRole: z.string(),
  entities: z.array(buildEntitySchema),
  /** Empty until the worker instantiates the blueprint. */
  sections: z.array(planSectionSchema),
  clarifications: z.array(clarificationSchema).optional(),
  /** When the student confirmed the key terms (spec stage 2 done criterion). */
  confirmedAt: z.string().nullable().optional(),
  /** Entity id → section ids that introduce it before the objectives (spec §2 "coverage matrix"). */
  coverage: z.record(z.string(), z.array(z.string())),
  /** Entities nothing introduces before the objectives; the build adds a section for them. */
  uncovered: z.array(z.string()),
});
export type ChapterBuildPlan = z.infer<typeof chapterBuildPlanSchema>;

export const ISSUE_STATUSES = ['open', 'fixed', 'accepted_by_user'] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

/** Spec §2.5 `ValidationIssue`. */
export const validationIssueSchema = z.object({
  id: z.string(),
  checkId: z.string(),
  severity: z.enum(['blocking', 'warning']),
  sectionId: z.string(),
  /** The sentence or span the issue is about, as it reads; empty for a section-level issue. */
  sentence: z.string(),
  explanation: z.string(),
  suggestedFix: z.string(),
  status: z.enum(ISSUE_STATUSES),
  /** The pitfall bank code when check T2 or the examiner matched one. */
  pitfallCode: z.string().optional(),
  /** Who raised it: a deterministic check or the examiner pass. */
  by: z.enum(['code', 'examiner']),
  /** Which pass: 1 before the fix loop, 2 after it. */
  pass: z.number().int().min(1).max(2),
  /** Reason the student gave when accepting it (dismissing). */
  userNote: z.string().optional(),
});
export type ValidationIssue = z.infer<typeof validationIssueSchema>;

export const reportSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  blueprintRef: z.string(),
  status: z.enum([
    'planned',
    'drafted',
    'fixed',
    'failed_validation',
    'passed',
    'refused',
    'error',
  ]),
  words: z.number().int().min(0),
  citations: z.number().int().min(0),
  /** `[[NEEDS SOURCE: …]]` notes the draft left. */
  needsSource: z.array(z.string()),
  /** The pending draft block's id in the chapter (a `SuggestionEvent` id), once inserted. */
  draftId: z.string().nullable(),
  /** Why a section could not be written (no sources; provider error). */
  note: z.string().optional(),
});
export type ReportSection = z.infer<typeof reportSectionSchema>;

export const reportCheckSchema = z.object({
  checkId: z.string(),
  label: z.string(),
  /** `skipped`: not enabled for this discipline, or nothing to check. */
  status: z.enum(['pass', 'fail', 'warn', 'skipped']),
  /** Open issues counted under this check after the fix loop. */
  open: z.number().int().min(0),
  /** Issues the fix loop cleared. */
  fixed: z.number().int().min(0),
  /** For assembly checks: how many the assembler corrected in code. */
  corrected: z.number().int().min(0).optional(),
  note: z.string().optional(),
});
export type ReportCheck = z.infer<typeof reportCheckSchema>;

export const reportReferenceSchema = z.object({
  sourceId: z.string(),
  shortRef: z.string(),
  title: z.string().nullable(),
  year: z.number().int().nullable(),
  doi: z.string().nullable(),
  /** RESOLVED | UNRESOLVED | PENDING | FAILED */
  status: z.string(),
  grounding: z.string(),
  /** Times the chapter cites it. */
  uses: z.number().int().min(0),
});
export type ReportReference = z.infer<typeof reportReferenceSchema>;

/** Spec §11: the QA report is "the main product difference from Jenni". */
export const chapterBuildReportSchema = z.object({
  sections: z.array(reportSectionSchema),
  checks: z.array(reportCheckSchema),
  issues: z.array(validationIssueSchema),
  /** Everything the drafts asked for and did not have, with the section asking. */
  evidenceNeeded: z.array(z.object({ sectionId: z.string(), note: z.string() })),
  references: z.array(reportReferenceSchema),
  similarity: z.object({
    /** Twelve-word runs found copied from a passage. */
    copiedRuns: z.number().int().min(0),
    checkedWords: z.number().int().min(0),
  }),
  totals: z.object({
    words: z.number().int().min(0),
    citations: z.number().int().min(0),
    blockingOpen: z.number().int().min(0),
    warningsOpen: z.number().int().min(0),
    fixed: z.number().int().min(0),
    /** Rupees the build spent, from real token counts. */
    spentInr: z.number().min(0),
  }),
  /** Spec §10: the optional AI-assistance statement the student may paste into the thesis. */
  disclosure: z.string(),
  /** Spec §10: medicine, pharmacy and law carry a note. */
  sensitiveNote: z.string().optional(),
  /** Every university profile is unconfirmed until a human has read the manual. */
  universityUnconfirmed: z.boolean(),
});
export type ChapterBuildReport = z.infer<typeof chapterBuildReportSchema>;

/** PLANNED: key terms extracted, waiting for the student to confirm them; no unit taken yet. */
export const BUILD_STATUSES = [
  'PLANNED',
  'QUEUED',
  'RUNNING',
  'DONE',
  'REFUSED',
  'FAILED',
] as const;

/** What the student may change on the plan screen before the build starts. */
export const planEditSchema = z.object({
  entities: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(120),
        type: z.string().trim().min(1).max(40),
        aliases: z.array(z.string().trim().min(1).max(120)).max(10),
        sourceObjective: z.number().int().min(0).max(50),
      }),
    )
    .max(25),
  answers: z.array(z.object({ id: z.string(), answer: z.string().trim().max(300) })).max(10),
});
export type PlanEdit = z.infer<typeof planEditSchema>;
export type BuildStatus = (typeof BUILD_STATUSES)[number];

export const BUILD_STAGES = [
  'loading',
  'extracting',
  'planning',
  'evidence',
  'drafting',
  'assembling',
  'checking',
  'examining',
  'fixing',
  'delivering',
] as const;
export type BuildStage = (typeof BUILD_STAGES)[number];

export const buildProgressSchema = z.object({
  stage: z.enum(BUILD_STAGES),
  sectionsTotal: z.number().int().min(0),
  sectionsDone: z.number().int().min(0),
  note: z.string().optional(),
});
export type BuildProgress = z.infer<typeof buildProgressSchema>;

/** `chapter-build` — one chapter, planned, written, checked and delivered as drafts (ADR-0039). */
export type ChapterBuildJob = {
  buildId: string;
  documentId: string;
  chapterId: string;
  userId: string;
  profile: ChapterProfile;
};

/** The most sections one build writes; the CHAPTER_BUILD price profile is computed for it. */
export const CHAPTER_BUILD_MAX_SECTIONS = 14;
