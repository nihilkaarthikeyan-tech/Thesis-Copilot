/**
 * The mock extraction — a structurally valid `PaperExtraction` derived from the paper's own text,
 * so an upload is usable with `AI_PROVIDER=mock`, before real provider keys exist.
 *
 * The property that matters is that it invents nothing: every field is copied from the input or
 * left empty, the same rule A.5 gives the real model.
 */

import { paperExtractionSchema } from '@tc/types';
import { describe, expect, it } from 'vitest';
import {
  deriveExtraction,
  mockExtractionResponse,
  paperTextFromMessage,
} from '../src/mock-extraction.js';

const paper = [
  'Solar adoption in rural Karnataka',
  '',
  'Abstract',
  'We survey 312 households across three districts.',
  'Cost is the leading barrier.',
  '',
  '1. Introduction',
  'Rooftop solar has grown since 2015.',
  '',
  '2. Method',
  'We administered a structured questionnaire.',
  '',
  'References',
  '[1] Kumar, A. (2021). Solar adoption. Energy Policy. https://doi.org/10.1016/j.enpol.2021.112121',
  '[2] Rao, B. (2019). Wind siting.',
  '    Renewable Energy, 140, 55.',
].join('\n');

describe('paperTextFromMessage', () => {
  it('unwraps the A.5 user message', () => {
    expect(paperTextFromMessage('<paper filename="p01.pdf">BODY TEXT</paper>')).toBe('BODY TEXT');
  });

  it('returns the content unchanged when it is not wrapped', () => {
    expect(paperTextFromMessage('plain text')).toBe('plain text');
  });
});

describe('deriveExtraction', () => {
  const extraction = deriveExtraction(paper);

  it('produces something the §10.7.1 schema accepts', () => {
    expect(() => paperExtractionSchema.parse(extraction)).not.toThrow();
  });

  it('takes the title from the first non-heading line', () => {
    expect(extraction.title).toBe('Solar adoption in rural Karnataka');
  });

  it('takes the abstract from under the Abstract heading', () => {
    expect(extraction.abstract).toBe(
      'We survey 312 households across three districts. Cost is the leading barrier.',
    );
  });

  it('captures reference entries verbatim, including their numbering', () => {
    expect(extraction.references.map((r) => r.raw)).toEqual([
      '[1] Kumar, A. (2021). Solar adoption. Energy Policy. https://doi.org/10.1016/j.enpol.2021.112121',
      '[2] Rao, B. (2019). Wind siting. Renewable Energy, 140, 55.',
    ]);
  });

  it('joins a wrapped continuation onto the entry above it', () => {
    expect(extraction.references[1]?.raw).toContain('Renewable Energy, 140, 55.');
    expect(extraction.references).toHaveLength(2);
  });

  it('picks up a DOI printed in the entry, and only then', () => {
    expect(extraction.references[0]?.doi).toBe('10.1016/j.enpol.2021.112121');
    expect(extraction.references[1]?.doi).toBeUndefined();
  });

  it('lists the headings it found', () => {
    expect(extraction.sections.map((s) => s.heading)).toEqual([
      'Abstract',
      '1. Introduction',
      '2. Method',
      'References',
    ]);
  });

  it('invents nothing: fields it cannot find stay empty', () => {
    const sparse = deriveExtraction('Just a title line and nothing else.');
    expect(sparse.title).toBe('Just a title line and nothing else.');
    expect(sparse.abstract).toBe('');
    expect(sparse.references).toEqual([]);
    expect(sparse.objectives).toEqual([]);
    expect(sparse.findings).toEqual([]);
    expect(sparse.terminology).toEqual([]);
  });

  it('copes with empty input', () => {
    const empty = deriveExtraction('');
    expect(empty.title).toBe('');
    expect(() => paperExtractionSchema.parse(empty)).not.toThrow();
  });
});

describe('mockExtractionResponse', () => {
  it('matches only an EXTRACT request', () => {
    expect(mockExtractionResponse.match({ action: 'EXTRACT' })).toBe(true);
    expect(mockExtractionResponse.match({ action: 'ASSIST' })).toBe(false);
  });

  it('answers from the paper in the request', () => {
    const result = mockExtractionResponse.respond({
      messages: [{ content: `<paper filename="p01.pdf">${paper}</paper>` }],
    });
    expect((result as { title: string }).title).toBe('Solar adoption in rural Karnataka');
  });
});
