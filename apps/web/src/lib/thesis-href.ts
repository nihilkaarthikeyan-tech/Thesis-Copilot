/**
 * Where "open this thesis" goes: the chapter last open here for it, else its first chapter. Shared
 * by the thesis list's Write and the editor's thesis switcher (R32, ADR-0127), so both land in the
 * same place.
 */

import type { LastChapter } from './last-chapter';

export type ThesisRef = { id: string; firstChapterId: string | null };

export function thesisWriteHref(doc: ThesisRef, last: LastChapter | null): string {
  return last?.documentId === doc.id
    ? `/app/d/${doc.id}/write/${last.chapterId}`
    : `/app/d/${doc.id}/write/${doc.firstChapterId ?? 'none'}`;
}

/**
 * The New ▾ menu's three ways in (R32, ADR-0127). Each is the existing `/app/new` chooser with its
 * starting point already chosen; nothing is created until the student presses a button there.
 */
export type NewStart = 'topic' | 'paper' | 'word';

export const NEW_START_PARAM = 'start';

export function newThesisHref(start: NewStart): string {
  return `/app/new?${NEW_START_PARAM}=${start}`;
}

export function readNewStart(search: string): NewStart | null {
  const value = new URLSearchParams(search).get(NEW_START_PARAM);
  return value === 'topic' || value === 'paper' || value === 'word' ? value : null;
}
