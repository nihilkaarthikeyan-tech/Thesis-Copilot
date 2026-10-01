/**
 * What the first real chapter build found (2026-10-01, gpt-5-mini on a Hastelloy EDM thesis),
 * each pinned in code so it cannot come back:
 *
 * - every section came back wrapped in the request's own `<section title="…">` tags;
 * - the model wrote `[[NEEDS SOURCE: …]]` inside sentences, so the marker reached the student as
 *   text and L3 read "NEEDS" and "SOURCE" as undefined abbreviations — and the fixer then
 *   "defined" them ("[[Needs Evidence (NEEDS) Source (SOURCE): …]]");
 * - it wrote "## Copper" and moved on when it had no source, leaving empty headings;
 * - L3 flagged "AF" in "AF‑5", "SUS" in "SUS 304": grade names, not abbreviations;
 * - the intake question about a term's meaning fired for "copper", typed correctly as a material.
 */

import { disciplineProfile, universityProfile } from '@tc/config';
import { describe, expect, it } from 'vitest';
import {
  type CheckContext,
  enabledChecks,
  intakeQuestions,
  normaliseDraftMarkdown,
  postProcessDraft,
  postProcessEntities,
  runChecks,
} from '../src/index.js';

const passages = [{ id: 'S1#c1', shortRef: 'Kumar 2021', page: 1, text: 'A passage about EDM.' }];

describe('normaliseDraftMarkdown', () => {
  it('removes the echoed request tags and keeps the prose', () => {
    const { text } = normaliseDraftMarkdown(
      '<section title="Introduction to the review">\nThe review covers three themes. {{cite:S1#c1}}\n</section>',
    );
    expect(text).toBe('The review covers three themes. {{cite:S1#c1}}');
  });

  it('pulls an inline needs-source marker out of the sentence and keeps it as a note', () => {
    const { text, inlineNotes } = normaliseDraftMarkdown(
      'Reviews report methods (for example [[NEEDS SOURCE: full forms for TOPSIS AHP VIKOR]]) but note limits. {{cite:S1#c1}}',
    );
    expect(inlineNotes).toEqual(['full forms for TOPSIS AHP VIKOR']);
    expect(text).toBe('Reviews report methods (for example) but note limits. {{cite:S1#c1}}');
    expect(text).not.toContain('NEEDS');
  });

  it('leaves a marker on its own line for A.2 post-processing', () => {
    const { text, inlineNotes } = normaliseDraftMarkdown(
      'A sentence. {{cite:S1#c1}}\n\n[[NEEDS SOURCE: figures for the remaining districts]]',
    );
    expect(inlineNotes).toEqual([]);
    expect(text).toContain('[[NEEDS SOURCE: figures for the remaining districts]]');
  });

  it('drops a heading with nothing under it and brings every heading to ###', () => {
    const { text } = normaliseDraftMarkdown(
      '## Copper\n\n### Graphite\n\nGraphite electrodes are common. {{cite:S1#c1}}\n\n## Copper‑tungsten\n\n## Hastelloy C‑276\n\n#### Electrode material (general)\n\nElectrode material matters. {{cite:S1#c1}}\n\n## Trailing',
    );
    expect(text).toBe(
      '### Graphite\n\nGraphite electrodes are common. {{cite:S1#c1}}\n\n### Electrode material (general)\n\nElectrode material matters. {{cite:S1#c1}}',
    );
  });

  it('postProcessDraft carries the inline notes into needsSource and none into the text', () => {
    const { result } = postProcessDraft(
      '<section title="Summary">\nA claim with a note [[NEEDS SOURCE: a comparison on C-276]] stands here and says more. {{cite:S1#c1}}\n</section>\n\n[[NEEDS SOURCE: recast layer data]]',
      passages,
      500,
    );
    expect(result.needsSource).toEqual(['a comparison on C-276', 'recast layer data']);
    expect(result.markdown).not.toMatch(/NEEDS SOURCE|<section|<\/section>/);
    expect(result.markdown).toContain('A claim with a note stands here');
  });
});

describe('L3 on grade names', () => {
  it('does not ask for "AF" in "AF‑5", "S" in "S‑180" or "SUS" in "SUS 304"', () => {
    const discipline = disciplineProfile('engineering_core_v1');
    const ctx: CheckContext = {
      discipline,
      university: universityProfile('generic_author_year_v1'),
      chapterRole: 'LITERATURE',
      sections: [
        {
          id: 'a',
          title: 'a',
          blueprintRef: 'x',
          markdown:
            'Fine (AF‑5, 1 μm) and coarse (S‑180, 10 μm) POCO graphites were compared on SUS 304 steel. {{cite:S1#c1}} The TWR fell.',
          entities: [],
          isObjectives: false,
          generic: false,
          organisation: false,
          summary: false,
          dataOnly: false,
        },
      ],
      entities: [],
      passages: new Map(),
      sourceYears: [],
      objectives: [],
      language: 'en',
      knownAbbreviations: [],
      pitfalls: [],
      enabled: enabledChecks(discipline.specialChecks),
      now: new Date(),
    };
    const l3 = runChecks(ctx).issues.filter((i) => i.checkId === 'L3');
    // POCO is a brand the check cannot know; TWR is a real undefined abbreviation.
    expect(l3.map((i) => i.explanation)).toEqual([
      expect.stringContaining('POCO'),
      expect.stringContaining('TWR'),
    ]);
  });
});

describe('intake questions', () => {
  it('asks what a term is only when the model could not type it', () => {
    const discipline = disciplineProfile('engineering_core_v1');
    const input = {
      title: 'EDM of Hastelloy',
      objectives: ['To compare copper and graphite electrodes; to measure the flux.'],
      questions: [],
      hypotheses: [],
      entityTypes: discipline.entityTypes,
    };
    const entities = postProcessEntities(
      {
        entities: [
          { text: 'copper', type: 'MATERIAL', sourceObjective: 1, aliases: [] },
          { text: 'flux', type: 'THING', sourceObjective: 1, aliases: [] },
          { text: 'EDM', type: 'PROCESS', sourceObjective: 0, aliases: [] },
        ],
      },
      input,
    );
    const questions = intakeQuestions(entities, {
      objectives: input.objectives,
      fallbackType: 'MATERIAL',
    });
    expect(questions.map((q) => [q.kind, q.entityId])).toEqual([
      ['meaning', 'E02'],
      ['abbreviation', 'E03'],
    ]);
  });
});

describe('L9 on prefixed words', () => {
  it('does not read "interrelated" or "nonspecific" as two words run together', () => {
    const discipline = disciplineProfile('engineering_core_v1');
    const ctx: CheckContext = {
      discipline,
      university: universityProfile('generic_author_year_v1'),
      chapterRole: 'LITERATURE',
      sections: [
        {
          id: 'a',
          title: 'a',
          blueprintRef: 'x',
          markdown:
            'Three interrelated measures recur, and the nonspecific fiberreinforced layer was studied. {{cite:S1#c1}}',
          entities: [],
          isObjectives: false,
          generic: false,
          organisation: false,
          summary: false,
          dataOnly: false,
        },
      ],
      entities: [],
      passages: new Map(),
      sourceYears: [],
      objectives: [],
      language: 'en',
      knownAbbreviations: [],
      pitfalls: [],
      enabled: enabledChecks(discipline.specialChecks),
      now: new Date(),
    };
    const l9 = runChecks(ctx).issues.filter((i) => i.checkId === 'L9');
    expect(l9.map((i) => i.suggestedFix)).toEqual(['Write “fiber-reinforced”.']);
  });
});
