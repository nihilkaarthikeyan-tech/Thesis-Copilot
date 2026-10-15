/**
 * ADR-0078 — the citation a stored record prints, for the author lists the indexes gave real
 * papers in the same-topic run (2026-10-05).
 */

import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { familyWithoutStop, peopleFirst, toCslItem } from '../src/csl.js';
import { renderCitations } from '../src/render.js';

const STYLES_DIR = fileURLToPath(new URL('../styles/', import.meta.url));

describe('a family name with a stray full stop (ADR-0155, the Word test)', () => {
  const source = {
    id: 's9',
    title: 'Power on the Roof: Reviewing Rooftop Solar Adoption in India',
    year: 2025,
    authors: [
      { given: 'S.', family: 'Mohammed.' },
      { given: 'P.', family: 'Maheswari' },
    ],
  };

  it('prints "Mohammed & Maheswari", in the text and in the reference list', () => {
    const out = renderCitations(
      { style: 'apa', sources: [source], citations: [{ key: 'k1', sourceId: 's9' }] },
      STYLES_DIR,
    );
    expect(out.labels.k1).toBe('(Mohammed & Maheswari, 2025)');
    expect(out.bibliography[0]?.text).toMatch(/^Mohammed, S\., & Maheswari, P\. \(2025\)/);
  });

  it('keeps the stop of an initial or a short abbreviation', () => {
    expect(familyWithoutStop('Mohammed.')).toBe('Mohammed');
    expect(familyWithoutStop('A.')).toBe('A.');
    expect(familyWithoutStop('St.')).toBe('St.');
    expect(familyWithoutStop('Kumar')).toBe('Kumar');
  });
});

describe('peopleFirst', () => {
  it('prints the people, not the college listed around them', () => {
    const item = toCslItem({
      id: 's1',
      title: 'A Study on Fintech Adoption by Women in Rural Areas of Virudhunagar District',
      year: 2025,
      authors: [
        { literal: 'Sri Kaliswari College' },
        { given: 'P.', family: 'Mathivathana' },
        { given: 'A.', family: 'Alagulakshmi' },
        { literal: 'Sri Kaliswari College' },
      ],
    });
    expect(item.author).toEqual([
      { given: 'P.', family: 'Mathivathana' },
      { given: 'A.', family: 'Alagulakshmi' },
    ]);
  });

  it('repairs a "-" or single-initial family, and keeps good names', () => {
    expect(peopleFirst([{ given: 'Sneha A', family: '-' }])).toEqual([
      { given: 'A', family: 'Sneha' },
    ]);
    expect(peopleFirst([{ given: 'Vimlesh', family: 'Tanwar' }])).toEqual([
      { given: 'Vimlesh', family: 'Tanwar' },
    ]);
    expect(peopleFirst([{ literal: 'World Bank' }])).toEqual([{ literal: 'World Bank' }]);
  });
});
