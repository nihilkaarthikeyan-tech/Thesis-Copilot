/**
 * ADR-0078 — author lists as the indexes gave them for real papers in the same-topic run
 * (2026-10-05), and what a citation should name.
 */

import { describe, expect, it } from 'vitest';
import { shortReference } from '../src/pgvector.js';
import { cleanAuthors } from '../src/scholarly/names.js';

describe('cleanAuthors', () => {
  it('drops the college listed around the people', () => {
    const authors = cleanAuthors([
      { literal: 'Sri Kaliswari College' },
      { given: 'P.', family: 'Mathivathana' },
      { given: 'A.', family: 'Alagulakshmi' },
      { literal: 'Sri Kaliswari College' },
    ]);
    expect(authors.map((a) => a.family)).toEqual(['Mathivathana', 'Alagulakshmi']);
  });

  it('finds the name when the family field is "-" or an initial', () => {
    expect(cleanAuthors([{ given: 'Sneha A', family: '-' }])[0]).toEqual({
      given: 'A',
      family: 'Sneha',
    });
    expect(cleanAuthors([{ given: 'Ms. Sneha', family: 'A' }])[0]).toEqual({
      given: 'A',
      family: 'Sneha',
    });
  });

  it('splits a whole name given as the family', () => {
    expect(cleanAuthors([{ given: '', family: 'K. V. Kiruthika' }])[0]).toEqual({
      given: 'K. V.',
      family: 'Kiruthika',
    });
  });

  it('leaves good names, and an author list of only an institution, as they are', () => {
    const good = [{ given: 'Vimlesh', family: 'Tanwar' }];
    expect(cleanAuthors(good)).toEqual(good);
    const org = [{ literal: 'World Bank' }];
    expect(cleanAuthors(org)).toEqual(org);
  });
});

describe('shortReference on records stored before the repair', () => {
  it('names the first person, not the college or a dash', () => {
    expect(
      shortReference(
        [{ literal: 'Sri Kaliswari College' }, { given: 'P.', family: 'Mathivathana' }],
        2025,
        'A Study on Fintech Adoption',
      ),
    ).toBe('Mathivathana 2025');
    expect(shortReference([{ given: 'Sneha A', family: '-' }], 2026, 'Mobile Banking')).toBe(
      'Sneha 2026',
    );
  });
});
