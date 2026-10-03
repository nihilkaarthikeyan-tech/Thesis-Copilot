import { describe, expect, it } from 'vitest';
import {
  applicableElements,
  blueprintFor,
  disciplineProfile,
  isMethodSection,
  PARADIGM_GUIDANCE,
  PARADIGM_LABELS,
  PARADIGMS,
  writingGuidance,
} from '../src/profiles/index.js';

describe('paradigm writing guidance (ADR-0047)', () => {
  it('has guidance and a label for every paradigm', () => {
    for (const p of PARADIGMS) {
      expect(PARADIGM_GUIDANCE[p].evidence.length, p).toBeGreaterThan(20);
      expect(PARADIGM_GUIDANCE[p].avoid.length, p).toBeGreaterThan(0);
      expect(PARADIGM_LABELS[p], p).toBeTruthy();
    }
  });

  it('gives a method section the validity vocabulary, and another section only evidence', () => {
    const law = disciplineProfile('law_v1');
    const method = writingGuidance(law, 'doctrinal', 'Research methodology');
    expect(method).toContain('binding or persuasive');
    expect(method).toContain('obiter');
    const review = writingGuidance(law, 'doctrinal', 'Literature review');
    expect(review).toContain('statutes by name');
    expect(review).not.toContain('binding or persuasive');
    // Grounding: guidance is about form, and says so every time.
    expect(review).toContain('Write only what the passages support');
  });

  it('humanities speaks of interpretive validity, qualitative of trustworthiness', () => {
    const hum = disciplineProfile('humanities_arts_v1');
    expect(writingGuidance(hum, 'textual', 'Method of reading')).toContain('hermeneutic');
    const soc = disciplineProfile('social_sciences_education_v1');
    expect(writingGuidance(soc, 'qualitative', 'Methodology')).toContain('trustworthiness');
  });

  it('recognises method-type section titles', () => {
    for (const t of ['Methodology', 'Materials and methods', 'Research design', 'Simulation setup'])
      expect(isMethodSection(t), t).toBe(true);
    for (const t of ['Introduction', 'Literature review', 'Discussion'])
      expect(isMethodSection(t), t).toBe(false);
  });
});

describe('the simulation paradigm (ADR-0047)', () => {
  it('gives a simulation Methodology its own sections and none of the bench-experiment ones', () => {
    const method = blueprintFor('METHOD');
    expect(method).toBeTruthy();
    const keys = applicableElements(method ?? { role: 'METHOD', label: '', elements: [] }, {
      paradigm: 'simulation',
      requiresTheoreticalFramework: false,
      chapterSummaryRequired: false,
    }).map((e) => e.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'method.model',
        'method.domain',
        'method.numerics',
        'method.validation',
        'method.parametric',
        'method.environment',
      ]),
    );
    expect(keys).not.toContain('method.materials');
    expect(keys).not.toContain('method.population');
  });

  it('is offered to engineering', () => {
    expect(disciplineProfile('engineering_core_v1').defaultParadigms).toContain('simulation');
  });
});
