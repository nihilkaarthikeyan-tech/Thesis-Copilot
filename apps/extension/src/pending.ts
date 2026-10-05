/**
 * The paper a right-clicked link names, handed from the service worker to the popup (ADR-0069).
 * Kept in `chrome.storage.session` — memory only, gone when the browser closes — and taken (read
 * and removed) by the next popup that opens, if it is less than two minutes old.
 */

import type { Paper } from './paper.js';

export type PendingLink = { paper: Paper; at: number };
export const PENDING_KEY = 'pendingLink';
export const PENDING_TTL_MS = 2 * 60 * 1000;

/** The pending link if it is fresh and well-formed, else null. Pure, for the tests. */
export function freshPending(value: unknown, now: number): PendingLink | null {
  if (!value || typeof value !== 'object') return null;
  const { paper, at } = value as Partial<PendingLink>;
  if (typeof at !== 'number' || now - at > PENDING_TTL_MS || now < at) return null;
  if (!paper || typeof paper.doi !== 'string' || typeof paper.reference !== 'string') return null;
  return { paper, at };
}
