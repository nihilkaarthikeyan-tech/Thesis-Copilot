/**
 * The check suite's shared shapes — ADR-0039, spec §7. A check reads a `CheckContext` and returns
 * `RawIssue`s; the worker gives them ids and a status and writes them into the report.
 */

import type { ChapterRole, CheckId, DisciplineProfile, UniversityProfile } from '@tc/config';
import type { BuildEntity } from '@tc/types';

export type CheckSection = {
  id: string;
  title: string;
  blueprintRef: string;
  /** The section's Markdown as the draft path produced it: `###` headings, `{{cite:ID}}` markers. */
  markdown: string;
  /** Entity ids the plan asked this section to introduce. */
  entities: readonly string[];
  isObjectives: boolean;
  generic: boolean;
  organisation: boolean;
  summary: boolean;
  dataOnly: boolean;
};

export type CheckPassage = {
  id: string;
  text: string;
  sourceId: string;
  year: number | null;
};

export type CheckPitfall = {
  code: string;
  /** Regular-expression source, case-insensitive, when the entry has one. */
  pattern: string | null;
  wrong: string;
  correct: string;
  severity: 'blocking' | 'warning';
};

export type CheckContext = {
  discipline: DisciplineProfile;
  university: UniversityProfile;
  chapterRole: ChapterRole;
  sections: readonly CheckSection[];
  entities: readonly BuildEntity[];
  /** Passages by section id: the evidence pack each section drew on. */
  passages: ReadonlyMap<string, readonly CheckPassage[]>;
  /** Years of the sources the chapter cites (one per source). */
  sourceYears: readonly number[];
  /** The thesis's objectives, verbatim (check S5). */
  objectives: readonly string[];
  /** IETF tag of the thesis's language; non-Latin scripts skip the Latin-only checks (L3, spelling). */
  language: string;
  /** Abbreviations the thesis already defines (front matter, glossary), so L3 does not ask again. */
  knownAbbreviations: readonly string[];
  pitfalls: readonly CheckPitfall[];
  enabled: ReadonlySet<CheckId>;
  now: Date;
};

export type RawIssue = {
  checkId: CheckId;
  severity: 'blocking' | 'warning';
  /** A section id, or `chapter` for an issue about the chapter as a whole. */
  sectionId: string;
  sentence: string;
  explanation: string;
  suggestedFix: string;
  pitfallCode?: string;
};

export const CHAPTER_LEVEL = 'chapter';
