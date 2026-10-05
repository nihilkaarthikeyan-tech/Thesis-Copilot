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
