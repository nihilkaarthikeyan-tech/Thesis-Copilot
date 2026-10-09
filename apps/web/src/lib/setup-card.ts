/**
 * ADR-0145: the pieces of the "Set up this thesis" card that are not drawing — making a new
 * thesis, the folded Sources line, and where in the chapter the first sentence goes.
 */

import { INDEX_LIST_LABELS, type SourcePrefs, UNTITLED_THESIS } from '@tc/types';
import type { Node as PmNode } from '@tiptap/pm/model';
import type { MessageKey } from '@/i18n';
import { api } from './api';

type T = (key: MessageKey, values?: Record<string, string | number>) => string;

/**
 * New: the thesis is made at once and opens on its first chapter with the setup card at its first
 * row. A title typed beforehand (the list's first-thesis form, `/app/new`) is kept, and its paper
 * search starts at creation as before (ADR-0070); otherwise it is "Untitled thesis" until the
 * card's first row names it. The chapters wait for the card's questions (`askFirst`).
 */
export async function createThesisForSetup(title?: string): Promise<{
  id: string;
  firstChapterId: string | null;
}> {
  return api<{ id: string; firstChapterId: string | null }>('/documents', {
    method: 'POST',
    body: JSON.stringify({
      title: title?.trim() || UNTITLED_THESIS,
      entryPath: 'A_TOPIC',
      start: 'writing',
      askFirst: true,
      setup: true,
    }),
  });
}

/** Where a new thesis opens: its first chapter, or the outline when it has none. */
export function setupHref(created: { id: string; firstChapterId: string | null }): string {
  return created.firstChapterId
    ? `/app/d/${created.id}/write/${created.firstChapterId}`
    : `/app/d/${created.id}/outline`;
}

/** "APA 7 · web and library · all years · any journal · preprints": the folded Sources line. */
export function sourcesLine(prefs: SourcePrefs, styleName: string | null, t: T): string {
  const parts: string[] = [];
  if (styleName) parts.push(styleName);
  parts.push(
    prefs.webSearch && prefs.librarySearch
      ? t('setup.src.webAndLibrary')
      : prefs.webSearch
        ? t('setup.src.web')
        : t('setup.src.library'),
  );
  parts.push(
    prefs.yearFrom || prefs.yearTo
      ? t('setup.src.years', {
          from: prefs.yearFrom ?? '…',
          to: prefs.yearTo ?? t('setup.src.now'),
        })
      : t('setup.src.allYears'),
  );
  parts.push(
    prefs.indexedIn.length > 0
      ? prefs.indexedIn.map((list) => INDEX_LIST_LABELS[list]).join(', ')
      : t('setup.src.anyJournal'),
  );
  parts.push(prefs.preprints ? t('setup.src.preprints') : t('setup.src.noPreprints'));
  return parts.join(' · ');
}

/** Words written in the chapter outside its headings: the first line is written at three. */
export function bodyWords(doc: PmNode): number {
  let words = 0;
  doc.descendants((node) => {
    if (node.type.name === 'heading') return false;
    if (node.isText) words += (node.text ?? '').trim().split(/\s+/).filter(Boolean).length;
    return true;
  });
  return words;
}

export const FIRST_LINE_WORDS = 3;

/**
 * Where the first sentence goes: inside the empty line under the chapter's first section heading,
 * or under the chapter's title when it has no sections. Null when there is no such empty line
 * (something is written there already).
 */
export function firstLinePosition(doc: PmNode): number | null {
  let found: number | null = null;
  let fallback: number | null = null;
  let previous: PmNode | null = null;
  doc.forEach((node, offset) => {
    if (found !== null) return;
    const emptyLine = node.type.name === 'paragraph' && node.content.size === 0;
    if (emptyLine && previous?.type.name === 'heading') {
      const level = Number(previous.attrs.level ?? 1);
      if (level >= 2) found = offset + 1;
      else if (fallback === null) fallback = offset + 1;
    }
    previous = node;
  });
  return found ?? fallback;
}
