/**
 * A chapter as a picker shows it: its own title, once, numbered correctly.
 *
 * A title that already carries its number ("Chapter 1 — Introduction", "1. Introduction") is shown
 * as it is. Any other is numbered by its place in the thesis — the list arrives in order — and
 * never by the stored `order`, which is a sort key and may start at 1.
 */

const NUMBERED = /^(?:chapter|ch\.)\s*[0-9ivxlc]+\b|^[0-9]+\s*[.):—–-]/i;

export function chapterLabel(title: string, index: number): string {
  const trimmed = title.trim();
  if (NUMBERED.test(trimmed)) return trimmed;
  return `${index + 1}. ${trimmed || 'Untitled chapter'}`;
}
