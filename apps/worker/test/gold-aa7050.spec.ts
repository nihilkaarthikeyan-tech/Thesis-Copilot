/**
 * Engineering gold test #1 — the specification's §13.2, on the original AA7050 hybrid composite
 * thesis, Chapter 1.
 *
 * The chapter itself is not in the repository (the agent must never fabricate fixtures, §0.3
 * rule 2). Until a human puts it at `fixtures/thesis/aa7050-chapter1.docx`, this suite reports
 * BLOCKED and skips. Once it is there, the deterministic checks run over the chapter as one
 * section and the spec's list is asserted: what code can find without a model. The examiner's
 * share of the list (S4, T1, T3 and the semantic pitfalls) needs a real model and is not asserted
 * here; the gold-test report prints what was and was not caught so a person can judge recall.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type CheckContext, type CheckSection, enabledChecks, runChecks } from '@tc/ai';
import { disciplineProfile, PITFALL_SEED, universityProfile } from '@tc/config';
import { extractDocx } from '@tc/retrieval';
import { describe, expect, it } from 'vitest';

const CHAPTER = fileURLToPath(
  new URL('../../../fixtures/thesis/aa7050-chapter1.docx', import.meta.url),
);
const present = existsSync(CHAPTER);

/** §13.2's list, the part deterministic code is expected to catch. */
const EXPECTED = {
  S1: ['AA7050', 'hybrid', 'titanium interface', 'SSCC'],
  'D-ENG2': ['K2Br'],
  'D-ENG3': ['graphite', 'Ti3Al', 'Al2O3'],
  T2: [
    'ENG-TRIB-001',
    'ENG-EDM-001',
    'ENG-EDM-002',
    'ENG-SCC-001',
    'ENG-COMP-001',
    'ENG-COMP-002',
    'ENG-PROC-001',
    'ENG-PROC-002',
    'ENG-WEAR-001',
    'ENG-WEAR-002',
    'ENG-CORR-002',
  ],
  L3: ['AMC', 'FRM'],
  L4: ['Electric discharge machining'],
  L9: ['proper-ties'],
};

describe('§13.2 gold test — AA7050 Chapter 1', () => {
  it.skipIf(present)('is not available yet', () => {
    console.log(
      'BLOCKED: fixtures/thesis/aa7050-chapter1.docx does not exist — see fixtures/thesis/README.md',
    );
    expect(true).toBe(true);
  });

  it.skipIf(!present)(
    'the deterministic checks catch the specification’s list',
    async () => {
      const { text } = await extractDocx(new Uint8Array(readFileSync(CHAPTER)));
      const markdown = text
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean)
        .join('\n\n');
      const discipline = disciplineProfile('engineering_core_v1');
      const objectivesIndex = markdown.search(/\n#*\s*(?:1\.\d+\s+)?objectives?\b/i);
      const sections: CheckSection[] = [
        {
          id: 'body',
          title: 'Chapter 1',
          blueprintRef: 'intro.body',
          markdown: objectivesIndex > 0 ? markdown.slice(0, objectivesIndex) : markdown,
          entities: [],
          isObjectives: false,
          generic: false,
          organisation: false,
          summary: false,
          dataOnly: false,
        },
        {
          id: 'objectives',
          title: 'Objectives',
          blueprintRef: 'intro.objectives',
          markdown: objectivesIndex > 0 ? markdown.slice(objectivesIndex) : '',
          entities: [],
          isObjectives: true,
          generic: false,
          organisation: false,
          summary: false,
          dataOnly: false,
        },
      ];
      const ctx: CheckContext = {
        discipline,
        university: universityProfile('generic_author_year_v1'),
        chapterRole: 'INTRODUCTION',
        sections,
        entities: EXPECTED.S1.map((text, i) => ({
          id: `E0${i + 1}`,
          text,
          type: 'MATERIAL',
          aliases: [],
          sourceObjective: 1,
          coveredBy: [],
        })),
        passages: new Map(),
        sourceYears: [],
        objectives: [],
        language: 'en',
        knownAbbreviations: [],
        pitfalls: PITFALL_SEED.map((p) => ({
          code: p.code,
          pattern: p.pattern ?? null,
          wrong: p.wrongPattern,
          correct: p.correctStatement,
          severity: p.severity,
        })),
        enabled: enabledChecks(discipline.specialChecks),
        now: new Date(),
      };
      const { issues } = runChecks(ctx);
      const by = (id: string) => issues.filter((i) => i.checkId === id);
      const report: string[] = [];
      let caught = 0;
      let expected = 0;
      for (const [check, items] of Object.entries(EXPECTED)) {
        for (const item of items) {
          expected++;
          const hit = by(check).some(
            (i) =>
              i.pitfallCode === item ||
              `${i.sentence} ${i.explanation}`.toLowerCase().includes(item.toLowerCase()),
          );
          if (hit) caught++;
          report.push(`${hit ? 'caught ' : 'MISSED '} ${check}: ${item}`);
        }
      }
      console.log(
        `\nGold test §13.2 — ${caught}/${expected} of the code-checkable list caught\n${report.join('\n')}\n`,
      );
      // §13.1: at least 90% recall of the annotated blocking issues the code is responsible for.
      expect(caught / expected).toBeGreaterThanOrEqual(0.9);
    },
    120_000,
  );
});
