/**
 * Discipline and university profiles — ADR-0039, from the specification's §4 and §6.
 *
 * "One engine, many discipline profiles": the pipeline, the checks and the assembly are the same
 * for every department, and everything that differs — what counts as a key term, how a chapter is
 * shaped, which checks apply, what the citation style is — is data here. Adding a department is
 * adding a row, not changing the engine.
 */

import type { ChapterRole } from '../templates.js';
import type { CheckId } from './checks.js';

/** The specification's research paradigms, which pick the Methodology variant. */
export const PARADIGMS = [
  'experimental',
  'quantitative',
  'qualitative',
  'mixed',
  'computational',
  'design_build',
  'theoretical',
  'doctrinal',
  'textual',
  'clinical',
] as const;
export type Paradigm = (typeof PARADIGMS)[number];

export const PARADIGM_LABELS: Readonly<Record<Paradigm, string>> = {
  experimental: 'Experimental',
  quantitative: 'Quantitative (survey)',
  qualitative: 'Qualitative',
  mixed: 'Mixed methods',
  computational: 'Computational',
  design_build: 'Design and build',
  theoretical: 'Theoretical',
  doctrinal: 'Doctrinal (law)',
  textual: 'Textual / critical',
  clinical: 'Clinical',
};

/** One kind of key term a discipline's objectives carry: a material, a population, a statute… */
export type EntityType = {
  readonly code: string;
  readonly label: string;
  /** One line the extraction prompt shows so the model knows what to look for. */
  readonly hint: string;
};

/** One preferred term and the forms the chapter must not mix it with (check L4). */
export type TerminologyRule = {
  readonly preferred: string;
  readonly avoid: readonly string[];
};

export type DisciplineProfile = {
  readonly id: string;
  readonly displayName: string;
  readonly departments: readonly string[];
  readonly defaultParadigms: readonly Paradigm[];
  readonly entityTypes: readonly EntityType[];
  /** A CSL style id, the common default; the university profile overrides it. */
  readonly defaultCitationStyle: string;
  /** Share of the chapter's paragraphs that may be generic background (check S3). */
  readonly genericBackgroundCap: number;
  /** Check E1: how many citations a factual paragraph needs. */
  readonly minCitationsPerFactualParagraph: number;
  /** Check E7: this share of the cited sources should be within this many years. */
  readonly recencyTarget: { readonly years: number; readonly share: number };
  /** Where the literature is looked for, in words the student sees. */
  readonly evidenceSources: readonly string[];
  /** Discipline-specific checks this profile turns on, beyond the universal ones. */
  readonly specialChecks: readonly CheckId[];
  readonly terminology: readonly TerminologyRule[];
  /** What the examiner is asked to look at particularly, in this discipline. */
  readonly examinerFocus: readonly string[];
  /** Chapter 2 needs a theoretical or conceptual framework section. */
  readonly requiresTheoreticalFramework: boolean;
  /** Shown on every build in this discipline (spec §10: medicine, pharmacy, law). */
  readonly sensitiveNote?: string;
  /** Words the checks must not read as undefined abbreviations (units, common notation). */
  readonly knownAbbreviations: readonly string[];
};

export type SpellingVariant = 'british' | 'american';

export type UniversityProfile = {
  readonly id: string;
  readonly displayName: string;
  /** CSL style id. */
  readonly citationStyle: string;
  readonly inText: {
    readonly surnamesOnly: boolean;
    readonly separator: string;
    readonly conjunction: 'and' | '&';
    /** From this many authors, "et al." */
    readonly etAlFrom: number;
  };
  readonly spelling: SpellingVariant;
  readonly chapterSummaryRequired: boolean;
  /** False until a human has checked every value against the university's own thesis manual. */
  readonly confirmed: boolean;
  readonly manual?: { readonly name: string; readonly version: string; readonly date: string };
};

/** One element of a chapter blueprint (spec §5): what a section is for and whether it must exist. */
export type BlueprintElement = {
  /** Stable key, e.g. `intro.background`; sections built from it carry it as `blueprintRef`. */
  readonly key: string;
  readonly title: string;
  readonly purpose: string;
  /** How the section is written: what it must cover, in the words the draft prompt receives. */
  readonly instructions: string;
  /**
   * `always`: every thesis; `most`: on by default, the student may disable; `university`: on
   * when the university profile asks for it; `paradigm`: on for the listed paradigms;
   * `framework`: on when the discipline needs a theoretical framework.
   */
  readonly required: 'always' | 'most' | 'university' | 'paradigm' | 'framework';
  readonly paradigms?: readonly Paradigm[];
  /** One section per group of key terms is generated from this element (spec §5.1). */
  readonly perEntityGroup?: boolean;
  /** The section every key term must be introduced before (check S1). */
  readonly isObjectives?: boolean;
  /** Counts as generic background for check S3. */
  readonly generic?: boolean;
  /** The one place "this chapter is organised as follows" is allowed (check L8). */
  readonly organisation?: boolean;
  /** The summary: nothing new, judged by the examiner (check S4). */
  readonly summary?: boolean;
  /** Written only from the student's own data; numbers without data are flagged (check E9). */
  readonly dataOnly?: boolean;
  /** Target length in words, when the element has a natural size. */
  readonly targetWords?: number;
  /**
   * Written from the thesis's own memory, not from sources (objectives, organisation, scope,
   * summaries): the draft is attempted even when retrieval finds no passage.
   */
  readonly noEvidence?: boolean;
};

export type ChapterBlueprint = {
  readonly role: ChapterRole;
  readonly label: string;
  readonly elements: readonly BlueprintElement[];
};
