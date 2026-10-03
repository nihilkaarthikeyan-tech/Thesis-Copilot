import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderCitations } from '../src/render.js';

const STYLES_DIR = fileURLToPath(new URL('../styles/', import.meta.url));

const SOURCES = [
  {
    id: 's1',
    title: 'Solar drying of marine fish',
    authors: [{ family: 'Kumar', given: 'A.' }],
    year: 2021,
    venue: 'Renewable Energy',
  },
];

describe('narrative citations (ADR-0045)', () => {
  it('APA: narrative puts the author in the sentence and the year in brackets', () => {
    const r = renderCitations(
      {
        style: 'apa',
        sources: SOURCES,
        citations: [
          { key: 'p', sourceId: 's1' },
          { key: 'n', sourceId: 's1', role: 'narrative' },
        ],
      },
      STYLES_DIR,
    );
    expect(r.labels.p).toBe('(Kumar, 2021)');
    expect(r.labels.n).toBe('Kumar (2021)');
  });

  it('IEEE: a numeric style keeps its number for a narrative citation', () => {
    const r = renderCitations(
      {
        style: 'ieee',
        sources: SOURCES,
        citations: [{ key: 'n', sourceId: 's1', role: 'narrative' }],
      },
      STYLES_DIR,
    );
    expect(r.labels.n).toContain('[1]');
  });
});
