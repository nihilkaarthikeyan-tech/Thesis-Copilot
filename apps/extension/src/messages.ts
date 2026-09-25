/**
 * What the popup asks the service worker, and what it answers (ADR-0031).
 *
 * The requests to Thesis Copilot are made by the service worker, not the popup: a popup closes the
 * moment the student clicks anywhere else, and a request started there would be cut off with it.
 */

import type { Paper } from './paper.js';

export type Thesis = { id: string; title: string };

export type Request = { type: 'theses' } | { type: 'add'; documentId: string; paper: Paper };

export type Added = { added: boolean; alreadyPresent: boolean };

/** `status` 0 means the site could not be reached at all. */
export type Failure = { ok: false; status: number; message: string };

export type Reply<T> = { ok: true; value: T } | Failure;
