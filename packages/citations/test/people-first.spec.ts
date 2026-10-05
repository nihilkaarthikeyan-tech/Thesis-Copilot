/**
 * ADR-0078 — the citation a stored record prints, for the author lists the indexes gave real
 * papers in the same-topic run (2026-10-05).
 */

import { describe, expect, it } from 'vitest';
import { peopleFirst, toCslItem } from '../src/csl.js';

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
