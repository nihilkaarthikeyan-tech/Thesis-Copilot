/**
 * The check suite — ADR-0039, spec §7. `runChecks` runs every deterministic check that is enabled
 * for the discipline and returns the raw issues; the worker adds the examiner's, gives each an id
 * and writes the report.
 */

import { type CheckId, UNIVERSAL_CHECKS } from '@tc/config';
import {
  checkEquations,
  checkFormulae,
  checkPitfalls,
  checkPropertyRanges,
  checkUnits,
} from './correctness.js';
import {
  checkHypothesisVariables,
  checkMetricsDefined,
  checkPicoAndEthics,
  checkQuotations,
} from './discipline.js';
import {
  checkCopiedRuns,
  checkFabricatedData,
  checkRecency,
  checkUncitedNumbers,
  checkUncitedParagraphs,
} from './evidence.js';
import { checkAbbreviations, checkArtefacts, checkTerminology } from './language.js';
import { checkEntityCoverage, checkGenericShare, checkRequiredSections } from './structure.js';
import type { CheckContext, RawIssue } from './types.js';

export type CheckRun = {
  issues: RawIssue[];
  similarity: { copiedRuns: number; checkedWords: number };
};

/** The checks a discipline runs: every universal one, plus the ones its profile enables. */
export function enabledChecks(specialChecks: readonly CheckId[]): Set<CheckId> {
  return new Set<CheckId>([...UNIVERSAL_CHECKS, ...specialChecks]);
}

export function runChecks(ctx: CheckContext): CheckRun {
  const copied = checkCopiedRuns(ctx);
  const issues: RawIssue[] = [
    ...checkEntityCoverage(ctx),
    ...checkRequiredSections(ctx),
    ...checkGenericShare(ctx),
    ...checkUncitedParagraphs(ctx),
    ...checkUncitedNumbers(ctx),
    ...checkRecency(ctx),
    ...copied.issues,
    ...checkFabricatedData(ctx),
    ...checkAbbreviations(ctx),
    ...checkTerminology(ctx),
    ...checkArtefacts(ctx),
    ...checkPitfalls(ctx),
    ...checkEquations(ctx),
    ...checkFormulae(ctx),
    ...checkUnits(ctx),
    ...checkPropertyRanges(ctx),
    ...checkMetricsDefined(ctx),
    ...checkPicoAndEthics(ctx),
    ...checkHypothesisVariables(ctx),
    ...checkQuotations(ctx),
  ];
  return {
    issues,
    similarity: { copiedRuns: copied.copiedRuns, checkedWords: copied.checkedWords },
  };
}

export {
  type AssemblyCounts,
  type AssemblySection,
  assembleSections,
  fixSpacing,
} from './assemble.js';
export {
  chargeBalance,
  checkEquations,
  checkFormulae,
  checkPitfalls,
  checkPropertyRanges,
  checkUnits,
  PROPERTY_RANGES,
  parseFormula,
} from './correctness.js';
export {
  checkHypothesisVariables,
  checkMetricsDefined,
  checkPicoAndEthics,
  checkQuotations,
} from './discipline.js';
export {
  checkCopiedRuns,
  checkFabricatedData,
  checkRecency,
  checkUncitedNumbers,
  checkUncitedParagraphs,
} from './evidence.js';
export { checkAbbreviations, checkArtefacts, checkTerminology } from './language.js';
export {
  checkEntityCoverage,
  checkGenericShare,
  checkRequiredSections,
  coverageOf,
} from './structure.js';
export {
  measurementsIn,
  numbersIn,
  paragraphsOf,
  proseParagraphs,
  sentencesOf,
  wordCount,
} from './text.js';
export {
  CHAPTER_LEVEL,
  type CheckContext,
  type CheckPassage,
  type CheckPitfall,
  type CheckSection,
  type RawIssue,
} from './types.js';
