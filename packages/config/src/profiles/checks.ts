/**
 * The checks a chapter build runs — ADR-0039, from the specification's §7 validation suite.
 *
 * This is the catalogue: id, plain-words label, which layer it belongs to, and the severity the
 * specification gives it. The checks themselves are code in `packages/ai/src/checks/`; the
 * discipline profiles name which discipline-specific ones they enable. Kept here as data so the
 * QA report, the admin screens and the profiles all read one list.
 */

export const CHECK_LAYERS = ['structure', 'evidence', 'language', 'correctness'] as const;
export type CheckLayer = (typeof CHECK_LAYERS)[number];

export const CHECK_SEVERITIES = ['blocking', 'warning'] as const;
export type CheckSeverity = (typeof CHECK_SEVERITIES)[number];

export type CheckSpec = {
  readonly id: CheckId;
  readonly label: string;
  readonly layer: CheckLayer;
  readonly severity: CheckSeverity;
  /**
   * `code` runs deterministically in the worker; `examiner` is judged by the strong model in the
   * examiner pass with the section and its evidence; `assembly` is corrected in code before any
   * check runs and reported as a count.
   */
  readonly by: 'code' | 'examiner' | 'assembly';
  /** Universal checks run for every discipline; the rest only when a profile enables them. */
  readonly universal: boolean;
};

export const CHECK_IDS = [
  // Structure
  'S1',
  'S2',
  'S3',
  'S4',
  // Evidence
  'E1',
  'E2',
  'E3',
  'E4',
  'E5',
  'E7',
  'E8',
  'E9',
  // Language and mechanics
  'L1',
  'L2',
  'L3',
  'L4',
  'L5',
  'L7',
  'L8',
  'L9',
  // Correctness
  'T1',
  'T2',
  'T3',
  'T4',
  // Discipline
  'D-ENG1',
  'D-ENG2',
  'D-ENG3',
  'D-ENG4',
  'D-CS1',
  'D-MED1',
  'D-MED2',
  'D-MGT1',
  'D-MGT2',
  'D-LAW1',
  'D-HUM1',
] as const;
export type CheckId = (typeof CHECK_IDS)[number];

const spec = (
  id: CheckId,
  label: string,
  layer: CheckLayer,
  severity: CheckSeverity,
  by: CheckSpec['by'],
  universal = true,
): CheckSpec => ({ id, label, layer, severity, by, universal });

export const CHECKS: Readonly<Record<CheckId, CheckSpec>> = {
  S1: spec(
    'S1',
    'Every key term is introduced before the objectives use it',
    'structure',
    'blocking',
    'code',
  ),
  S2: spec('S2', 'Every required section is present', 'structure', 'blocking', 'code'),
  S3: spec('S3', 'Generic background stays within the cap', 'structure', 'warning', 'code'),
  S4: spec(
    'S4',
    'The summary claims only what the chapter contains',
    'structure',
    'blocking',
    'examiner',
  ),
  E1: spec('E1', 'No uncited factual paragraph', 'evidence', 'blocking', 'code'),
  E2: spec('E2', 'No uncited number, table or figure', 'evidence', 'blocking', 'code'),
  E3: spec('E3', 'Every reference is real and resolved', 'evidence', 'blocking', 'code'),
  E4: spec(
    'E4',
    'Each claim is supported by the source it cites',
    'evidence',
    'blocking',
    'examiner',
  ),
  E5: spec(
    'E5',
    'A finding is not applied outside its material, population or setting',
    'evidence',
    'blocking',
    'examiner',
  ),
  E7: spec('E7', 'Enough recent sources', 'evidence', 'warning', 'code'),
  E8: spec('E8', 'No twelve-word run copied from a source', 'evidence', 'blocking', 'code'),
  E9: spec(
    'E9',
    'No number in a Results chapter without data behind it',
    'evidence',
    'blocking',
    'code',
  ),
  L1: spec('L1', 'No duplicated sentences', 'language', 'blocking', 'assembly'),
  L2: spec('L2', 'A space after every sentence', 'language', 'blocking', 'assembly'),
  L3: spec('L3', 'Abbreviations defined at first use', 'language', 'blocking', 'code'),
  L4: spec('L4', 'One term for one thing', 'language', 'blocking', 'code'),
  L5: spec(
    'L5',
    'Tense: present for what is established, past for what a study did',
    'language',
    'warning',
    'examiner',
  ),
  L7: spec('L7', 'No connective with nothing to refer to', 'language', 'blocking', 'assembly'),
  L8: spec(
    'L8',
    'No "this section will…" outside the organisation section',
    'language',
    'warning',
    'assembly',
  ),
  L9: spec('L9', 'No hyphenation or extraction artefacts', 'language', 'warning', 'code'),
  T1: spec('T1', 'No internal contradiction', 'correctness', 'blocking', 'examiner'),
  T2: spec('T2', 'Nothing from the pitfall bank', 'correctness', 'blocking', 'code'),
  T3: spec(
    'T3',
    'Descriptions agree with the defining sentence',
    'correctness',
    'blocking',
    'examiner',
  ),
  T4: spec('T4', 'No factual or technical inaccuracy', 'correctness', 'blocking', 'examiner'),
  'D-ENG1': spec('D-ENG1', 'Chemical equations balance', 'correctness', 'blocking', 'code', false),
  'D-ENG2': spec('D-ENG2', 'Chemical formulae are valid', 'correctness', 'blocking', 'code', false),
  'D-ENG3': spec(
    'D-ENG3',
    'Property values are plausible',
    'correctness',
    'blocking',
    'code',
    false,
  ),
  'D-ENG4': spec(
    'D-ENG4',
    'SI units, matched to their quantity',
    'correctness',
    'blocking',
    'code',
    false,
  ),
  'D-CS1': spec(
    'D-CS1',
    'Every metric is defined before it is used',
    'correctness',
    'warning',
    'code',
    false,
  ),
  'D-MED1': spec(
    'D-MED1',
    'PICO elements and ethics approval present',
    'structure',
    'blocking',
    'code',
    false,
  ),
  'D-MED2': spec(
    'D-MED2',
    'Doses and drug names plausible',
    'correctness',
    'blocking',
    'examiner',
    false,
  ),
  'D-MGT1': spec(
    'D-MGT1',
    'Every hypothesis names variables defined earlier',
    'structure',
    'blocking',
    'code',
    false,
  ),
  'D-MGT2': spec(
    'D-MGT2',
    'Instrument reliability and validity reported',
    'structure',
    'warning',
    'examiner',
    false,
  ),
  'D-LAW1': spec(
    'D-LAW1',
    'Case and statute citations formatted; jurisdiction consistent',
    'evidence',
    'blocking',
    'examiner',
    false,
  ),
  'D-HUM1': spec(
    'D-HUM1',
    'Quotations cite edition and page and stay short',
    'evidence',
    'blocking',
    'code',
    false,
  ),
};

export const UNIVERSAL_CHECKS: readonly CheckId[] = CHECK_IDS.filter((id) => CHECKS[id].universal);

export function isCheckId(value: string): value is CheckId {
  return (CHECK_IDS as readonly string[]).includes(value);
}
