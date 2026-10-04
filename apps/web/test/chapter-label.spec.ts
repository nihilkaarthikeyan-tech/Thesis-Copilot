/**
 * The build page's chapter picker read "2. Chapter 1 — Introduction" for a thesis's first chapter:
 * a number added to a title that already had one, and taken from the stored sort key.
 */

import { describe, expect, it } from 'vitest';
import { chapterLabel } from '../src/lib/chapter-label.js';

describe('chapterLabel', () => {
  it('shows a title that already carries its number once, unchanged', () => {
    expect(chapterLabel('Chapter 1 — Introduction', 0)).toBe('Chapter 1 — Introduction');
    expect(chapterLabel('CHAPTER IV Results', 3)).toBe('CHAPTER IV Results');
    expect(chapterLabel('1. Introduction', 0)).toBe('1. Introduction');
  });

  it('numbers any other title by its place in the thesis', () => {
    expect(chapterLabel('Introduction', 0)).toBe('1. Introduction');
    expect(chapterLabel('Review of literature', 1)).toBe('2. Review of literature');
  });

  it('does not mistake a word that starts like "chapter" for a number', () => {
    expect(chapterLabel('Chapterhouse records', 0)).toBe('1. Chapterhouse records');
  });

  it('names an empty title', () => {
    expect(chapterLabel('  ', 2)).toBe('3. Untitled chapter');
  });

  it('keeps the editor list free of "1. Chapter 1 — Introduction" (2026-10-04)', () => {
    expect(chapterLabel('CHAPTER 3: Method', 2)).toBe('CHAPTER 3: Method');
    expect(chapterLabel('Chapters in brief', 4)).toBe('5. Chapters in brief');
  });
});
