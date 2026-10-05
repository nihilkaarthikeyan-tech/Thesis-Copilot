/**
 * ADR-0078 — a paper's "this study" about itself is named before the passage reaches the model,
 * so the draft never calls a source "this study" (which in a thesis means the student's own work).
 */

import { describe, expect, it } from 'vitest';
import { buildDraftRequest } from '../src/builder/draft.js';
import { nameTheSource } from '../src/builder/own-study.js';

describe('nameTheSource', () => {
  it('names the paper wherever it calls itself this study', () => {
    expect(nameTheSource('This study adopts a qualitative exploratory design.', 'Bagla 2026')).toBe(
      'The study by Bagla 2026 adopts a qualitative exploratory design.',
    );
    expect(
      nameTheSource(
        'Respondents in this study cited delays; the present paper argues…',
        'Bagla 2026',
      ),
    ).toBe('Respondents in the study by Bagla 2026 cited delays; the paper by Bagla 2026 argues…');
  });

  it('leaves other uses alone', () => {
    const text = 'The study used interviews. Earlier studies and this year’s data agree.';
    expect(nameTheSource(text, 'Bagla 2026')).toBe(text);
  });
});

describe('the draft request', () => {
  it('carries the named passage, not the paper’s own "this study"', () => {
    const request = buildDraftRequest({
      memoryBlock: 'memory',
      section: { outlineNodeId: 'n1', title: 'Financial constraints', scopeNote: '', children: [] },
      passages: [
        {
          id: 'S1#c1',
          shortRef: 'Bagla 2026',
          page: 9,
          text: 'This study adopts a qualitative design.',
        },
      ],
      targetWords: 300,
      tier: 'strong',
      userId: 'u',
      documentId: 'd',
    });
    const body = JSON.stringify(request.messages);
    expect(body).toContain('The study by Bagla 2026 adopts');
    expect(body).not.toContain('This study adopts');
  });
});

describe('a cited "this study" is dropped (ADR-0078)', () => {
  it('drops it from a suggestion, keeps the rest', async () => {
    const { filterSentences } = await import('../src/builder/quality.js');
    const { text } = filterSentences({
      text: 'Rural women face low digital literacy {{cite:S1#c1}}. This study focuses on rural women in Virudhunagar district {{cite:S1#c2}}.',
      before: 'Mobile banking is spreading in Tamil Nadu.',
      existing: '',
    });
    expect(text).toContain('low digital literacy');
    expect(text).not.toContain('This study focuses');
  });

  it('drops a cited sentence opening "The study focuses on…" (ADR-0079)', async () => {
    const { filterSentences, isCitedOwnStudy } = await import('../src/builder/quality.js');
    expect(
      isCitedOwnStudy('The study focuses on rural women in Virudhunagar district {{cite:S1#c6}}.'),
    ).toBe(true);
    expect(
      isCitedOwnStudy('The research was conducted in Virudhunagar District {{cite:S1#c10}}.'),
    ).toBe(true);
    // Mid-sentence, the source has been named.
    expect(
      isCitedOwnStudy('Bagla surveyed 312 households; the study found cost first {{cite:S1#c1}}.'),
    ).toBe(false);
    const { text } = filterSentences({
      text: 'Adoption rose from 11.1% of illiterate respondents to 72.2% of graduates {{cite:S1#c30}}. The study focuses on rural women in Virudhunagar district {{cite:S1#c6}}.',
      before: 'Digital literacy is the barrier most often named.',
      existing: '',
    });
    expect(text).toContain('72.2%');
    expect(text).not.toContain('The study focuses');
  });

  it('keeps an uncited "this study": it may be the student’s own', async () => {
    const { isCitedOwnStudy } = await import('../src/builder/quality.js');
    expect(isCitedOwnStudy('This study examines adoption in three districts.')).toBe(false);
    expect(isCitedOwnStudy('The study by Bagla 2026 found delays {{cite:S1#c1}}.')).toBe(false);
  });
});
