/**
 * University profiles — ADR-0039, spec §6.
 *
 * Formatting lives in the institution template (`InstitutionTemplate.spec`, Appendix D.3); this
 * carries what that spec does not: the in-text citation form, the spelling variant and whether a
 * chapter summary is required. Every value here is `confirmed: false` until a human has read the
 * university's own manual (spec §6: "All values must be confirmed … before release";
 * `docs/PENDING.md`). The build screen says so.
 */

import type { UniversityProfile } from './types.js';

export const UNIVERSITY_PROFILES: readonly UniversityProfile[] = [
  {
    id: 'generic_author_year_v1',
    displayName: 'Generic (author–year, British spelling)',
    citationStyle: 'apa',
    inText: { surnamesOnly: true, separator: '; ', conjunction: 'and', etAlFrom: 3 },
    spelling: 'british',
    chapterSummaryRequired: true,
    confirmed: false,
  },
  {
    id: 'generic_numeric_v1',
    displayName: 'Generic (numeric, IEEE, British spelling)',
    citationStyle: 'ieee',
    inText: { surnamesOnly: true, separator: ', ', conjunction: 'and', etAlFrom: 3 },
    spelling: 'british',
    chapterSummaryRequired: false,
    confirmed: false,
  },
  {
    id: 'generic_vancouver_v1',
    displayName: 'Generic (Vancouver, British spelling)',
    citationStyle: 'vancouver',
    inText: { surnamesOnly: true, separator: ', ', conjunction: 'and', etAlFrom: 6 },
    spelling: 'british',
    chapterSummaryRequired: false,
    confirmed: false,
  },
  {
    // The specification's worked example. Margins and fonts belong to the institution template;
    // the values the spec lists there are reproduced in docs/PENDING.md for whoever confirms them.
    id: 'anna_university_v1',
    displayName: 'Anna University (unconfirmed — check the manual)',
    citationStyle: 'apa',
    inText: { surnamesOnly: true, separator: '; ', conjunction: 'and', etAlFrom: 3 },
    spelling: 'british',
    chapterSummaryRequired: true,
    confirmed: false,
  },
  {
    id: 'generic_american_v1',
    displayName: 'Generic (author–year, American spelling)',
    citationStyle: 'apa',
    inText: { surnamesOnly: true, separator: '; ', conjunction: '&', etAlFrom: 3 },
    spelling: 'american',
    chapterSummaryRequired: false,
    confirmed: false,
  },
];

export const DEFAULT_UNIVERSITY_ID = 'generic_author_year_v1';

export function universityProfile(id: string | null | undefined): UniversityProfile {
  return (
    UNIVERSITY_PROFILES.find((profile) => profile.id === id) ??
    (UNIVERSITY_PROFILES.find(
      (profile) => profile.id === DEFAULT_UNIVERSITY_ID,
    ) as UniversityProfile)
  );
}

/**
 * Spelling pairs the L4 check reads: `[american, british]`. Only pairs where the variant is
 * unambiguous — "-ize" is accepted British usage too and is left alone.
 */
export const SPELLING_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['aluminum', 'aluminium'],
  ['fiber', 'fibre'],
  ['fibers', 'fibres'],
  ['color', 'colour'],
  ['colors', 'colours'],
  ['behavior', 'behaviour'],
  ['behaviors', 'behaviours'],
  ['center', 'centre'],
  ['centers', 'centres'],
  ['modeling', 'modelling'],
  ['modeled', 'modelled'],
  ['labeled', 'labelled'],
  ['labeling', 'labelling'],
  ['catalog', 'catalogue'],
  ['analyzing', 'analysing'],
  ['analyzed', 'analysed'],
  ['analyze', 'analyse'],
  ['program', 'programme'],
  ['meter', 'metre'],
  ['meters', 'metres'],
  ['liter', 'litre'],
  ['liters', 'litres'],
  ['gray', 'grey'],
  ['mold', 'mould'],
  ['sulfur', 'sulphur'],
  ['defense', 'defence'],
  ['license', 'licence'],
  ['favor', 'favour'],
  ['honor', 'honour'],
  ['neighbor', 'neighbour'],
  ['tumor', 'tumour'],
  ['tumors', 'tumours'],
  ['pediatric', 'paediatric'],
  ['anemia', 'anaemia'],
  ['esthetic', 'aesthetic'],
];
