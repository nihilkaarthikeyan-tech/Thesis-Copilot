/**
 * The chapter-build checks (ADR-0039) against the specification's own examples (§13.2): the
 * sentences Ranjith's evaluation found in a real Chapter 1, and the Hastelloy sample's faults.
 */

import { disciplineProfile, PITFALL_SEED, universityProfile } from '@tc/config';
import type { BuildEntity } from '@tc/types';
import { describe, expect, it } from 'vitest';
import {
  assembleSections,
  type CheckContext,
  type CheckSection,
  chargeBalance,
  enabledChecks,
  examinerSentences,
  fixSpacing,
  parseFormula,
  postProcessEntities,
  postProcessExaminer,
  runChecks,
  unchangedSentencesKept,
} from '../src/index.js';

const engineering = disciplineProfile('engineering_core_v1');
const university = universityProfile('generic_author_year_v1');

const section = (
  id: string,
  markdown: string,
  extra: Partial<CheckSection> = {},
): CheckSection => ({
  id,
  title: id,
  blueprintRef: `intro.${id}`,
  markdown,
  entities: [],
  isObjectives: false,
  generic: false,
  organisation: false,
  summary: false,
  dataOnly: false,
  ...extra,
});

const entity = (
  id: string,
  text: string,
  sourceObjective = 1,
  aliases: string[] = [],
): BuildEntity => ({
  id,
  text,
  type: 'MATERIAL',
  aliases,
  sourceObjective,
  coveredBy: [],
});

function context(sections: CheckSection[], overrides: Partial<CheckContext> = {}): CheckContext {
  return {
    discipline: engineering,
    university,
    chapterRole: 'INTRODUCTION',
    sections,
    entities: [],
    passages: new Map(),
    sourceYears: [],
    knownAbbreviations: [],
    pitfalls: PITFALL_SEED.map((p) => ({
      code: p.code,
      pattern: p.pattern ?? null,
      wrong: p.wrongPattern,
      correct: p.correctStatement,
      severity: p.severity,
    })),
    enabled: enabledChecks(engineering.specialChecks),
    now: new Date('2026-10-01T00:00:00Z'),
    ...overrides,
  };
}

const ids = (ctx: CheckContext) => runChecks(ctx).issues.map((i) => i.checkId);

describe('structure', () => {
  it('S1: a key term used in the objectives and introduced nowhere before them is blocking', () => {
    const ctx = context(
      [
        section('background', 'Aluminium alloys are used in aircraft structures. {{cite:p1}}'),
        section('objectives', 'To model the titanium interface of AA7050 composites under SSCC.', {
          isObjectives: true,
        }),
      ],
      {
        entities: [
          entity('E01', 'AA7050'),
          entity('E02', 'titanium interface'),
          entity('E03', 'SSCC'),
        ],
      },
    );
    const issues = runChecks(ctx).issues.filter((i) => i.checkId === 'S1');
    expect(issues.map((i) => i.sentence).sort()).toEqual(['AA7050', 'SSCC', 'titanium interface']);
    expect(issues.every((i) => i.severity === 'blocking' && i.sectionId === 'objectives')).toBe(
      true,
    );
  });

  it('S1: an alias counts as an introduction', () => {
    const ctx = context(
      [
        section(
          'background',
          'Sulphide stress corrosion cracking (SSCC) is a failure mode of steels. {{cite:p1}}',
        ),
        section('objectives', 'To study SSCC in the alloy.', { isObjectives: true }),
      ],
      { entities: [entity('E01', 'SSCC', 1, ['Sulphide stress corrosion cracking'])] },
    );
    expect(ids(ctx)).not.toContain('S1');
  });

  it('S2: a required section with no text is blocking', () => {
    expect(ids(context([section('gap', '')]))).toContain('S2');
  });

  it('S3: generic paragraphs over the cap are a warning', () => {
    const generic = Array.from(
      { length: 5 },
      (_, i) =>
        `Materials are all around us and engineering studies them in many ways for many purposes in society today, from bridges to aircraft and from tools to medical implants, number ${i}.`,
    ).join('\n\n');
    const ctx = context(
      [
        section('fundamentals', generic, { generic: true }),
        section(
          'subject',
          'AA7050 is an aluminium alloy used in aircraft structures because of its high strength. {{cite:p1}}',
        ),
      ],
      {
        entities: [entity('E01', 'AA7050')],
      },
    );
    expect(ids(ctx)).toContain('S3');
  });
});

describe('evidence', () => {
  it('E1: an uncited factual paragraph in a literature review is blocking', () => {
    const paragraph =
      'Wire electrical discharge machining removes material by a series of discharges between the wire and the workpiece, and the material removal rate rises with pulse energy while the surface finish worsens, so the two must be traded off in every practical application of the process to hard alloys.';
    const ctx = context([section('theme', paragraph)], { chapterRole: 'LITERATURE' });
    const issue = runChecks(ctx).issues.find((i) => i.checkId === 'E1');
    expect(issue?.severity).toBe('blocking');
  });

  it('E1: the same paragraph with a citation passes', () => {
    const paragraph =
      'Wire electrical discharge machining removes material by a series of discharges between the wire and the workpiece, and the material removal rate rises with pulse energy while the surface finish worsens, so the two must be traded off in every practical application of the process to hard alloys. {{cite:p1}}';
    expect(
      ids(context([section('theme', paragraph)], { chapterRole: 'LITERATURE' })),
    ).not.toContain('E1');
  });

  it('E2: a figure with a unit and no citation is blocking; a year is not a figure', () => {
    const ctx = context([
      section('subject', 'The alloy has a tensile strength of 520 MPa. It was introduced in 1985.'),
    ]);
    const issues = runChecks(ctx).issues.filter((i) => i.checkId === 'E2');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.explanation).toContain('520 MPa');
  });

  it('E7: too few recent sources is a warning', () => {
    const ctx = context([section('theme', 'Text. {{cite:p1}}')], {
      sourceYears: [1998, 2001, 2004, 2009, 2011],
    });
    expect(ids(ctx)).toContain('E7');
    expect(
      ids(
        context([section('theme', 'Text. {{cite:p1}}')], { sourceYears: [2019, 2021, 2023, 2005] }),
      ),
    ).not.toContain('E7');
  });

  it('E8: twelve words copied from a passage are blocking', () => {
    const passage =
      'The coefficient of friction was found to decrease with increasing graphite content because a tribolayer formed on the worn surface.';
    const ctx = context(
      [
        section(
          'theme',
          `Studies report that the coefficient of friction was found to decrease with increasing graphite content because a tribolayer formed. {{cite:p1}}`,
        ),
      ],
      { passages: new Map([['theme', [{ id: 'p1', text: passage, sourceId: 's1', year: 2020 }]]]) },
    );
    const run = runChecks(ctx);
    expect(run.issues.map((i) => i.checkId)).toContain('E8');
    expect(run.similarity.copiedRuns).toBe(1);
  });

  it('E9: a number in a Results section with no data behind it is blocking', () => {
    const ctx = context(
      [
        section(
          'results',
          'The wear rate fell to 0.0042 mm3/m at 5 wt% graphite. The hardness was 118 HV.',
          { dataOnly: true },
        ),
      ],
      {
        passages: new Map([
          [
            'results',
            [
              {
                id: 'd1',
                text: 'Sample C: wear rate 0.0042, hardness 96 HV',
                sourceId: 's1',
                year: null,
              },
            ],
          ],
        ]),
      },
    );
    const issues = runChecks(ctx).issues.filter((i) => i.checkId === 'E9');
    expect(issues.map((i) => i.explanation)).toEqual(
      expect.arrayContaining([expect.stringContaining('118')]),
    );
    expect(issues.some((i) => i.explanation.includes('0.0042'))).toBe(false);
  });
});

describe('language', () => {
  it('L3: AMC and FRM undefined at first use are blocking; a defined one is not', () => {
    const ctx = context([
      section(
        'subject',
        'Aluminium matrix composites (AMC) are light. FRM offers a different route. AMC is cheap.',
      ),
    ]);
    const issues = runChecks(ctx).issues.filter((i) => i.checkId === 'L3');
    expect(issues.map((i) => i.explanation)).toEqual([expect.stringContaining('FRM')]);
  });

  it('L3: units, formulae and the profile’s known abbreviations are not asked for', () => {
    const ctx = context([
      section(
        'subject',
        'SEM showed Al2O3 particles; the hardness was 120 HV at 500 MPa and ASTM G99 was followed.',
      ),
    ]);
    expect(ids(ctx)).not.toContain('L3');
  });

  it('L4: "Electric" and "Electrical" discharge machining mixed is blocking', () => {
    const ctx = context([
      section('a', 'Electrical discharge machining is thermal. {{cite:p1}}'),
      section('b', 'Electric discharge machining uses a dielectric. {{cite:p1}}'),
    ]);
    const issue = runChecks(ctx).issues.find((i) => i.checkId === 'L4');
    expect(issue?.severity).toBe('blocking');
    expect(issue?.suggestedFix).toContain('electrical discharge machining');
  });

  it('L4: American spelling under a British profile is a warning naming the British form', () => {
    const ctx = context([section('a', 'The aluminum matrix was studied. {{cite:p1}}')]);
    const issue = runChecks(ctx).issues.find(
      (i) => i.checkId === 'L4' && i.explanation.includes('American'),
    );
    expect(issue?.suggestedFix).toContain('aluminium');
  });

  it('L9: "proper-ties" is flagged when "properties" occurs elsewhere; "fiberreinforced" always', () => {
    const ctx = context([
      section(
        'a',
        'The mechanical proper-ties improved. The properties depend on the fiberreinforced layer. {{cite:p1}}',
      ),
    ]);
    const issues = runChecks(ctx).issues.filter((i) => i.checkId === 'L9');
    expect(issues.map((i) => i.suggestedFix).sort()).toEqual([
      'Write “fiber-reinforced”.',
      'Write “properties”.',
    ]);
  });

  it('L9: an ordinary hyphenated compound is left alone', () => {
    const ctx = context([
      section('a', 'The wear-rate and the non-linear response were measured. {{cite:p1}}'),
    ]);
    expect(ids(ctx)).not.toContain('L9');
  });
});

describe('correctness', () => {
  it('T2: the pitfall bank’s patterns fire on the evaluation’s sentences, with the correct statement', () => {
    const ctx = context([
      section('a', 'Statistically loaded specimens were tested. {{cite:p1}}'),
      section('b', 'The flux K₂Br was added to the melt. {{cite:p1}}'),
      section(
        'c',
        'Powder metallurgy involves melting and casting the blended powders. {{cite:p1}}',
      ),
      section('d', 'Friction is independent of the normal load in this regime. {{cite:p1}}'),
    ]);
    const issues = runChecks(ctx).issues.filter((i) => i.checkId === 'T2');
    expect(issues.map((i) => i.pitfallCode).sort()).toEqual([
      'ENG-CHEM-001',
      'ENG-PROC-001',
      'ENG-SCC-001',
      'ENG-TRIB-001',
    ]);
    expect(issues.find((i) => i.pitfallCode === 'ENG-SCC-001')?.suggestedFix).toBe(
      'Statically loaded.',
    );
  });

  it('D-ENG2: K₂Br is not a compound; Al2O3, KBr and K2TiF6 are fine; SEM is an abbreviation', () => {
    expect(chargeBalance(parseFormula('K2Br') as Map<string, number>)).toBe(1);
    expect(chargeBalance(parseFormula('Al2O3') as Map<string, number>)).toBe(0);
    expect(parseFormula('Xz2')).toBeNull();
    const ctx = context([
      section('a', 'The flux K2Br was used. {{cite:p1}}'),
      section('b', 'Al2O3, KBr, K2TiF6 and TiC were added after SEM and EDM. {{cite:p1}}'),
    ]);
    const issues = runChecks(ctx).issues.filter((i) => i.checkId === 'D-ENG2');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.sectionId).toBe('a');
  });

  it('D-ENG1: an unbalanced reaction is blocking; a balanced one is not', () => {
    const ctx = context([
      section('a', 'The reaction 2Al + 3CuO → Al2O3 + 3Cu proceeds. {{cite:p1}}'),
      section('b', 'The reaction Al + CuO → Al2O3 + Cu was proposed. {{cite:p1}}'),
    ]);
    const issues = runChecks(ctx).issues.filter((i) => i.checkId === 'D-ENG1');
    expect(issues.map((i) => i.sectionId)).toEqual(['b']);
  });

  it('D-ENG3: graphite hardness in the GPa range and Ti3Al at 28 GPa are blocking; Al2O3 density 3.95 is fine', () => {
    const ctx = context([
      section('a', 'Graphite has a hardness of about 25 GPa. {{cite:p1}}'),
      section('b', 'The Ti3Al phase has a hardness of 28 GPa. {{cite:p1}}'),
      section('c', 'Al2O3 has a density of 3.95 g/cm3 and a hardness of 18 GPa. {{cite:p1}}'),
      section('d', 'Graphite has a Vickers hardness of 12 HV. {{cite:p1}}'),
    ]);
    const issues = runChecks(ctx).issues.filter((i) => i.checkId === 'D-ENG3');
    expect(issues.map((i) => i.sectionId).sort()).toEqual(['a', 'b']);
  });

  it('D-ENG4: a density in GPa is blocking; psi is a non-SI warning', () => {
    const ctx = context([
      section('a', 'The density of the composite was 2.7 GPa. {{cite:p1}}'),
      section('b', 'The yield strength was 45 ksi. {{cite:p1}}'),
    ]);
    const issues = runChecks(ctx).issues.filter((i) => i.checkId === 'D-ENG4');
    expect(issues.find((i) => i.sectionId === 'a')?.severity).toBe('blocking');
    expect(issues.find((i) => i.sectionId === 'b')?.severity).toBe('warning');
  });
});

describe('discipline', () => {
  it('D-MGT1: a hypothesis naming no defined variable is blocking', () => {
    const management = disciplineProfile('management_commerce_v1');
    const ctx = context(
      [
        section(
          'h',
          'H1: Employees who feel valued perform better. H2: Job satisfaction increases retention.',
        ),
      ],
      {
        discipline: management,
        enabled: enabledChecks(management.specialChecks),
        entities: [
          { ...entity('E01', 'job satisfaction'), type: 'CONSTRUCT' },
          { ...entity('E02', 'retention'), type: 'VARIABLE_DV' },
        ],
      },
    );
    const issues = runChecks(ctx).issues.filter((i) => i.checkId === 'D-MGT1');
    expect(issues.map((i) => i.sentence)).toEqual([
      'H1: Employees who feel valued perform better.',
    ]);
  });

  it('D-CS1: a metric used without a definition is a warning', () => {
    const cs = disciplineProfile('electrical_cs_v1');
    const ctx = context(
      [section('a', 'The model reached an F1 of 0.91 on the test split. {{cite:p1}}')],
      {
        discipline: cs,
        enabled: enabledChecks(cs.specialChecks),
      },
    );
    expect(ids(ctx)).toContain('D-CS1');
    const defined = context(
      [
        section(
          'a',
          'F1 is defined as the harmonic mean of precision and recall. The model reached an F1 of 0.91. {{cite:p1}}',
        ),
      ],
      {
        discipline: cs,
        enabled: enabledChecks(cs.specialChecks),
      },
    );
    expect(ids(defined).filter((i) => i === 'D-CS1')).toHaveLength(0);
  });
});

describe('assembly', () => {
  it('L2: puts the space back after a sentence end', () => {
    const { text, fixed } = fixSpacing('Hastelloy EDM.This synthesis follows.Next point.');
    expect(text).toBe('Hastelloy EDM. This synthesis follows. Next point.');
    expect(fixed).toBe(2);
  });

  it('L1/L7/L8: removes a repeated sentence across sections, a connective opening a section, and roadmap filler', () => {
    const { sections, counts } = assembleSections([
      {
        id: 'a',
        organisation: false,
        markdown:
          'The brass wire electrode erodes at a rate set by the pulse energy and the wire speed. {{cite:p1}}\n\nThis section will synthesize the evidence on wire wear.',
      },
      {
        id: 'b',
        organisation: false,
        markdown:
          'However, the results differ.\n\nThe brass wire electrode erodes at a rate set by pulse energy and wire speed. {{cite:p1}} A second finding stands.',
      },
    ]);
    expect(counts).toEqual({ duplicates: 1, spacing: 0, dangling: 1, roadmap: 1 });
    expect(sections[1]?.markdown).toBe('A second finding stands.');
  });
});

describe('the model calls’ guards', () => {
  it('entities: a term not in the inputs is dropped, aliases must be in the inputs too', () => {
    const input = {
      title: 'Wear of AA7050 hybrid composites',
      objectives: ['To fabricate AA7050/TiC/graphite composites by stir casting.'],
      questions: [],
      hypotheses: [],
      entityTypes: engineering.entityTypes,
    };
    const entities = postProcessEntities(
      {
        entities: [
          {
            text: 'AA7050',
            type: 'MATERIAL',
            sourceObjective: 1,
            aliases: ['aluminium alloy 7050'],
          },
          { text: 'stir casting', type: 'PROCESS', sourceObjective: 1, aliases: [] },
          { text: 'squeeze casting', type: 'PROCESS', sourceObjective: 1, aliases: [] },
          { text: 'TiC', type: 'NOT_A_TYPE', sourceObjective: 9, aliases: [] },
        ],
      },
      input,
    );
    expect(entities.map((e) => e.text)).toEqual(['AA7050', 'stir casting', 'TiC']);
    expect(entities[0]?.aliases).toEqual([]);
    expect(entities[2]?.type).toBe('MATERIAL');
    expect(entities[2]?.sourceObjective).toBe(1);
  });

  it('examiner: an issue about a sentence that was not sent is dropped; a pitfall code must be in the request', () => {
    const sentences = examinerSentences(
      'Graphite has a hardness of about 25 GPa. {{cite:p1}}\n\nIt is a solid lubricant. {{cite:p1}}',
    );
    expect(sentences.map((s) => s.id)).toEqual(['s1', 's2']);
    const { issues, dropped } = postProcessExaminer(
      {
        issues: [
          {
            sentenceId: 's1',
            issueType: 'pitfall',
            explanation: 'Wrong.',
            correction: 'Soft.',
            severity: 'blocking',
            pitfallCode: 'ENG-PROP-001',
          },
          {
            sentenceId: 's1',
            issueType: 'made_up',
            explanation: 'x',
            correction: '',
            severity: 'odd',
            pitfallCode: 'NOPE',
          },
          {
            sentenceId: 's9',
            issueType: 'inaccuracy',
            explanation: 'x',
            correction: '',
            severity: 'blocking',
            pitfallCode: '',
          },
        ],
      },
      {
        sentences,
        pitfalls: [{ code: 'ENG-PROP-001', wrong: 'w', correct: 'c' }],
        discipline: engineering,
      },
    );
    expect(dropped).toBe(1);
    expect(issues.map((i) => [i.checkId, i.severity, i.pitfallCode ?? null])).toEqual([
      ['T2', 'blocking', 'ENG-PROP-001'],
      ['T4', 'blocking', null],
    ]);
  });

  it('fix: a rewrite that loses unflagged sentences is measured', () => {
    const original =
      'First sentence stays here. Second sentence is wrong here. Third sentence stays here.';
    const good =
      'First sentence stays here. Second sentence is now right. Third sentence stays here.';
    const bad = 'Everything was rewritten from scratch by the model.';
    expect(unchangedSentencesKept(original, good, ['Second sentence is wrong here.']).ratio).toBe(
      1,
    );
    expect(unchangedSentencesKept(original, bad, ['Second sentence is wrong here.']).ratio).toBe(0);
  });
});
