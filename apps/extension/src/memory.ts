/**
 * Which papers the in-page buttons have saved, per thesis — kept in `chrome.storage.local`, on
 * this computer only, so a button on a page the student comes back to says "Saved to Thesis
 * Copilot" instead of offering the same paper again (Jenni's button does the same; ours forgot on
 * every reload — observed 2026-10-10). Nothing is sent anywhere for it: the buttons are marked
 * from what this add-on itself saved, never by asking Thesis Copilot about the page.
 *
 * Only identifiers are kept (`doi:10.…`, `arxiv:2501.02840`, `pmid:41168360`, or a squashed
 * title for a result that names none), at most `PER_THESIS` per thesis and `THESES` theses, the
 * oldest dropped first. A paper removed from the library on the site keeps its mark here until it
 * is dropped; pressing the button still checks with the library.
 *
 * Pure, so it is tested without a browser.
 */

import type { PaperRef } from './refs.js';

export const SAVED_KEY = 'savedPapers';
export const PER_THESIS = 1_000;
export const THESES = 20;

/** Thesis id → the keys of the papers saved into it, oldest first. */
export type SavedPapers = Record<string, string[]>;

const squash = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .slice(0, 200);

/** The keys a paper is remembered by: each identifier, its DOI, else its title. */
export function paperKeys(paper: {
  refs: readonly PaperRef[];
  doi?: string | null;
  title?: string;
}): string[] {
  const keys = new Set<string>();
  for (const ref of paper.refs) keys.add(`${ref.kind}:${ref.id.toLowerCase()}`);
  if (paper.doi) keys.add(`doi:${paper.doi.toLowerCase()}`);
  if (keys.size === 0 && paper.title && squash(paper.title).length >= 8) {
    keys.add(`title:${squash(paper.title)}`);
  }
  return [...keys];
}

/** What was stored, as a `SavedPapers`; anything else is treated as nothing saved. */
export function readSaved(value: unknown): SavedPapers {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: SavedPapers = {};
  for (const [id, keys] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(keys)) out[id] = keys.filter((k): k is string => typeof k === 'string');
  }
  return out;
}

/** The store with `keys` added for `documentId`, within the limits. */
export function remember(
  stored: unknown,
  documentId: string,
  keys: readonly string[],
): SavedPapers {
  const saved = readSaved(stored);
  const before = (saved[documentId] ?? []).filter((key) => !keys.includes(key));
  const next = [...before, ...keys].slice(-PER_THESIS);
  // The thesis just saved into goes last, so the least recently used is dropped first.
  const entries = Object.entries(saved).filter(([id]) => id !== documentId);
  entries.push([documentId, next]);
  return Object.fromEntries(entries.slice(-THESES));
}

/** True when any of `keys` was saved into `documentId`. */
export function wasSaved(stored: unknown, documentId: string, keys: readonly string[]): boolean {
  const list = readSaved(stored)[documentId];
  return Boolean(list && keys.some((key) => list.includes(key)));
}
