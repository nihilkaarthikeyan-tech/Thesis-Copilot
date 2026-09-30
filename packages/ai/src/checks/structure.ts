/**
 * Structure checks — spec §7.1 S1–S3. S4 (summary fidelity) is the examiner's.
 */

import type { BuildEntity } from '@tc/types';
import { containsTerm, HAS_CITE, proseParagraphs, wordCount } from './text.js';
import { CHAPTER_LEVEL, type CheckContext, type RawIssue } from './types.js';

/** The sections (in chapter order) that introduce an entity: the first mention is the introduction. */
export function coverageOf(
  entities: readonly BuildEntity[],
  sections: ReadonlyArray<{ id: string; markdown: string }>,
): Map<string, string[]> {
  const coverage = new Map<string, string[]>();
  for (const entity of entities) {
    const forms = [entity.text, ...entity.aliases];
    const hits = sections
      .filter((s) => forms.some((form) => containsTerm(s.markdown, form)))
      .map((s) => s.id);
    coverage.set(entity.id, hits);
  }
  return coverage;
}

/** S1: every key term the objectives use is introduced in a section before the objectives. */
export function checkEntityCoverage(ctx: CheckContext): RawIssue[] {
  if (!ctx.enabled.has('S1')) return [];
  const objectivesIndex = ctx.sections.findIndex((s) => s.isObjectives);
  if (objectivesIndex === -1) return [];
  const objectives = ctx.sections[objectivesIndex] as CheckContext['sections'][number];
  const before = ctx.sections.slice(0, objectivesIndex);
  const issues: RawIssue[] = [];
  for (const entity of ctx.entities) {
    if (entity.sourceObjective === 0) continue;
    const forms = [entity.text, ...entity.aliases];
    const introduced = before.some((s) => forms.some((form) => containsTerm(s.markdown, form)));
    if (introduced) continue;
    issues.push({
      checkId: 'S1',
      severity: 'blocking',
      sectionId: objectives.id,
      sentence: entity.text,
      explanation: `“${entity.text}” is used in objective ${entity.sourceObjective} but no section before the objectives introduces it.`,
      suggestedFix: `Introduce ${entity.text} (what it is and why it was chosen) in the subject-specific background before the objectives.`,
    });
  }
  return issues;
}

/** S2: every required section has text. */
export function checkRequiredSections(ctx: CheckContext): RawIssue[] {
  if (!ctx.enabled.has('S2')) return [];
  return ctx.sections
    .filter((s) => proseParagraphs(s.markdown).length === 0)
    .map((s) => ({
      checkId: 'S2' as const,
      severity: 'blocking' as const,
      sectionId: s.id,
      sentence: '',
      explanation: `The section “${s.title}” is required by the chapter blueprint and has no text.`,
      suggestedFix: 'Pin sources that cover it and build again, or write it in Assist mode.',
    }));
}

/**
 * S3: generic background stays within the profile's cap. A paragraph is generic when it is in a
 * generic (fundamentals) section, or names no key term and cites nothing.
 */
export function checkGenericShare(ctx: CheckContext): RawIssue[] {
  if (!ctx.enabled.has('S3')) return [];
  let total = 0;
  let generic = 0;
  const forms = ctx.entities.flatMap((e) => [e.text, ...e.aliases]);
  for (const section of ctx.sections) {
    if (section.isObjectives || section.organisation || section.summary) continue;
    for (const paragraph of proseParagraphs(section.markdown)) {
      if (wordCount(paragraph) < 25) continue;
      total++;
      if (section.generic) {
        generic++;
        continue;
      }
      const mentions = forms.some((form) => containsTerm(paragraph, form));
      if (!mentions && !HAS_CITE.test(paragraph)) generic++;
    }
  }
  if (total === 0) return [];
  const share = generic / total;
  if (share <= ctx.discipline.genericBackgroundCap) return [];
  return [
    {
      checkId: 'S3',
      severity: 'warning',
      sectionId: CHAPTER_LEVEL,
      sentence: '',
      explanation: `${Math.round(share * 100)}% of the chapter's paragraphs are generic background (no key term, no citation); the ${ctx.discipline.displayName} profile allows ${Math.round(ctx.discipline.genericBackgroundCap * 100)}%.`,
      suggestedFix:
        'Shorten the fundamentals, or tie each background paragraph to a key term of this thesis.',
    },
  ];
}
