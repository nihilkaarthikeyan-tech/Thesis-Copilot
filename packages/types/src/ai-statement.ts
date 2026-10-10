/**
 * The AI use statement (ADR-0148): the recorded facts the statement is written from, and the
 * shape of a statement once the student has read and edited it.
 *
 * The facts are counts of rows this thesis already has — the provenance word counts on every
 * chapter, the AI call log, the suggestion events, the builds, the library. Nothing here is
 * estimated or modelled, and no model is called: the API counts, the web app puts the sentences
 * together in the student's interface language, and the student edits before using it. A feature
 * whose count is zero is not mentioned in the statement at all.
 */

import { z } from 'zod';

/** The features a statement can name, each with a count of recorded uses for this thesis. */
export const AI_STATEMENT_FEATURES = [
  /** Assist suggestions shown in the editor (`SuggestionEvent` ASSIST). */
  'suggestions',
  /** "Draft a section" and the draft path (`SuggestionEvent` DRAFT). */
  'drafting',
  /** Edit commands on a selected passage (`AiCallLog` COMMAND, less proofreading's calls). */
  'edits',
  /** Proofreading runs (`AuditEvent` PROOFREAD_RUN, recorded since ADR-0148). */
  'proofreading',
  /** Citation suggestions from the library (`AiCallLog` CITE). */
  'citations',
  /** Chat about the thesis (`AiCallLog` CHAT). */
  'chat',
  /** Deep research in chat (`AiCallLog` RESEARCH, ADR-0080). */
  'research',
  /** Literature searches whose queries a model wrote (`AiCallLog` SEARCH_QUERIES). */
  'literatureSearch',
  /** The chapter plan and the proposal conversation (`AiCallLog` OUTLINE, PROPOSAL). */
  'planning',
  /** Coherence and cross-paper checks (`AiCallLog` COHERENCE, CROSS_PAPER). */
  'checks',
  /** Whole chapters built and delivered as drafts (`ChapterBuild` CHAPTER, DONE; ADR-0039). */
  'chapterBuild',
  /** The literature review built whole (`ChapterBuild` LIT_REVIEW, DONE; ADR-0124). */
  'litReviewBuild',
  /** Examiner reviews (`AiCallLog` EXAMINER_REVIEW, ADR-0056). */
  'examinerReview',
  /** Viva preparation (`AiCallLog` VIVA, ADR-0030). */
  'viva',
] as const;

export type AiStatementFeature = (typeof AI_STATEMENT_FEATURES)[number];

/** Word counts of one chapter, from its provenance marks (`Chapter.wordCounts`, Appendix B.4). */
export type AiStatementChapter = {
  title: string;
  order: number;
  /** All words in the chapter. */
  total: number;
  /** Words still carrying an accepted-AI mark (ASSIST, DRAFT, COMMAND): not edited since. */
  aiUnedited: number;
  /** Words the student has edited inside accepted AI text (HUMAN_EDITED). */
  aiEdited: number;
  /** Words the record has as the student's own writing (HUMAN), pasted text included. */
  own: number;
  /** AI suggestions and drafts recorded against this chapter, any outcome. */
  actions: number;
};

export type AiStatementFacts = {
  documentTitle: string;
  /** The thesis's own language (PRD §2.2), not the interface's. */
  documentLanguage: string;
  /** `YYYY-MM-DD`: when the thesis was created here. */
  createdOn: string;
  /** `YYYY-MM-DD` of the first and last recorded AI action, or null when there is none. */
  from: string | null;
  to: string | null;
  /** Recorded uses per feature; 0 is "not used", and the statement leaves it out. */
  features: Record<AiStatementFeature, number>;
  /** Assist suggestions: how many were shown and how many the student kept, whole or in part. */
  suggestions: { shown: number; kept: number };
  /** Drafts: how many were delivered and how many the student accepted. */
  drafts: { shown: number; accepted: number };
  /** The whole thesis's words by provenance, summed over the chapters. */
  words: { total: number; aiUnedited: number; aiEdited: number; own: number };
  chapters: AiStatementChapter[];
  /** The library: all sources, those the product added on its own (ADR-0037), those cited. */
  sources: { total: number; autoAdded: number; cited: number };
};

/** What the student sends back after editing: the title and the paragraphs, nothing else. */
export const aiStatementTextSchema = z.object({
  title: z.string().trim().min(1).max(200),
  paragraphs: z.array(z.string().trim().min(1).max(4000)).min(1).max(40),
});

export type AiStatementText = z.infer<typeof aiStatementTextSchema>;

/** The optional per-chapter table, as rows of cells already written out. */
export const aiStatementTableSchema = z.object({
  header: z.array(z.string().trim().min(1).max(80)).min(2).max(8),
  rows: z.array(z.array(z.string().trim().max(200)).min(2).max(8)).max(200),
});

export type AiStatementTable = z.infer<typeof aiStatementTableSchema>;

/** `POST /documents/:id/ai-statement/appendix`. */
export const aiStatementAppendixSchema = aiStatementTextSchema.extend({
  table: aiStatementTableSchema.optional(),
});

export type AiStatementAppendix = z.infer<typeof aiStatementAppendixSchema>;

export function emptyAiStatementFeatures(): Record<AiStatementFeature, number> {
  return Object.fromEntries(AI_STATEMENT_FEATURES.map((f) => [f, 0])) as Record<
    AiStatementFeature,
    number
  >;
}
