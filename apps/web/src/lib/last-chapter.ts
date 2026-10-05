/**
 * The chapter a student last had open, so the thesis list can offer "Continue writing" straight
 * back into it (2026-10-04, from the Jenni study: a returning student there lands in the last
 * document; here they met a list with ten links per thesis).
 *
 * Kept in this browser only. It is a convenience, never a record: it can be missing, stale or
 * point at a thesis since deleted, and the list checks it against the theses it has loaded.
 */

const KEY = 'tc:last-chapter';

export type LastChapter = {
  documentId: string;
  chapterId: string;
  documentTitle: string;
  chapterTitle: string;
  /** ISO 8601, when it was last opened. */
  at: string;
};

export function rememberLastChapter(entry: Omit<LastChapter, 'at'>): void {
  markEnteredThisSession();
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...entry, at: new Date().toISOString() }));
  } catch {
    // Private windows and blocked storage: the list simply does not offer the shortcut.
  }
}

export function readLastChapter(): LastChapter | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<LastChapter>;
    if (
      typeof value.documentId !== 'string' ||
      typeof value.chapterId !== 'string' ||
      typeof value.at !== 'string'
    ) {
      return null;
    }
    return {
      documentId: value.documentId,
      chapterId: value.chapterId,
      documentTitle: value.documentTitle ?? '',
      chapterTitle: value.chapterTitle ?? '',
      at: value.at,
    };
  } catch {
    return null;
  }
}

const SESSION_KEY = 'tc:in-session';

/**
 * ADR-0073: whether this browser session has already been inside the app. The first visit to the
 * thesis list in a session goes straight back to the last chapter (as Jenni reopens the last
 * document); every visit after that — the "Theses" breadcrumb, a link — shows the list.
 */
export function enteredThisSession(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === '1';
  } catch {
    // No session storage: always show the list rather than redirect without being able to stop.
    return true;
  }
}

export function markEnteredThisSession(): void {
  try {
    sessionStorage.setItem(SESSION_KEY, '1');
  } catch {
    // Nothing to do.
  }
}
