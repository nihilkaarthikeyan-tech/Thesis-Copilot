import { describe, expect, it } from 'vitest';
import { chapterLabel } from '../src/lib/chapter-label';

describe('chapterLabel', () => {
  it('numbers a plain title', () => {
    expect(chapterLabel(2, 'Literature Review')).toBe('2. Literature Review');
  });

  it('does not number a title that already carries its number', () => {
    expect(chapterLabel(1, 'Chapter 1 — Introduction')).toBe('Chapter 1 — Introduction');
    expect(chapterLabel(3, 'CHAPTER 3: Method')).toBe('CHAPTER 3: Method');
    expect(chapterLabel(4, 'Ch. 4 Results')).toBe('Ch. 4 Results');
  });

  it('still numbers a title that merely mentions chapters', () => {
    expect(chapterLabel(5, 'Chapters in brief')).toBe('5. Chapters in brief');
  });
});
