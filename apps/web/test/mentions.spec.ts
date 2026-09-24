import { describe, expect, it } from 'vitest';
import { dropMentionQuery, mentionLabel, mentionQuery } from '../src/lib/mentions';

describe('the @query being typed', () => {
  it('is read from the end of the text', () => {
    expect(mentionQuery('What does @LeC')).toBe('LeC');
    expect(mentionQuery('@Jum')).toBe('Jum');
  });

  it('is empty straight after a bare @, so the picker opens on the whole library', () => {
    expect(mentionQuery('What does @')).toBe('');
  });

  it('is not a mention once the word is finished, or inside an email address', () => {
    expect(mentionQuery('What does @LeCun say')).toBeNull();
    expect(mentionQuery('write to kumar@uni.ac.in')).toBeNull();
    expect(mentionQuery('no mention here')).toBeNull();
  });

  it('leaves the question once a paper is chosen', () => {
    expect(dropMentionQuery('What does @LeC')).toBe('What does ');
    expect(dropMentionQuery('@Jum')).toBe('');
    expect(dropMentionQuery('write to kumar@uni.ac.in')).toBe('write to kumar@uni.ac.in');
  });
});

describe('a source as a student would name it', () => {
  it('is the first author and the year', () => {
    expect(
      mentionLabel({
        title: 'Deep learning',
        authors: [{ family: 'LeCun', given: 'Yann' }, { family: 'Bengio' }],
        year: 2015,
      }),
    ).toBe('LeCun 2015');
  });

  it('copes with a literal name, a "Family, Given" string and no author at all', () => {
    expect(
      mentionLabel({ title: 'x', authors: [{ literal: 'World Health Organization' }], year: 2020 }),
    ).toBe('Organization 2020');
    expect(mentionLabel({ title: 'x', authors: ['Kumar, R.'], year: null })).toBe('Kumar');
    expect(
      mentionLabel({ title: 'Highly accurate protein structure', authors: [], year: 2021 }),
    ).toBe('Highly accurate protein 2021');
    expect(mentionLabel({ title: null, authors: null, year: null })).toBe('Source');
  });
});
