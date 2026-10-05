/**
 * What the popup asks the service worker, and what it answers (ADR-0031, ADR-0069).
 *
 * The requests to Thesis Copilot are made by the service worker, not the popup: a popup closes the
 * moment the student clicks anywhere else, and a request started there would be cut off with it.
 * A bulk save keeps going in the service worker after the popup closes, and reports its progress
 * to the popup while it is open.
 */

import type { Paper } from './paper.js';

export type Thesis = { id: string; title: string };

export type Collection = { id: string; name: string; count: number };

/** One paper to save. `key` ties the answer back to the row the popup shows. */
export type SaveItem = { key: string; paper: Paper };

export type SaveJob = {
  /** Names this save in its progress messages. */
  runId: string;
  documentId: string;
  collectionId: string | null;
  items: SaveItem[];
  /**
   * The tab's PDF, to attach to the (single) paper saved: the student's own request for the file,
   * made with their cookies for that site. Null when the tab is not a PDF or they unticked it.
   */
  pdf: {
    url: string;
    filename: string;
    /** True when nothing but the file names the paper: no DOI, no scholarly title. */
    onlyThePdf: boolean;
  } | null;
};

export type ItemStatus = 'saved' | 'present' | 'failed';

export type ItemResult = {
  key: string;
  status: ItemStatus;
  /** The library row — for "Open in Thesis Copilot". Null when the save failed. */
  sourceId: string | null;
  message?: string;
};

/** What became of the tab's PDF. */
export type PdfOutcome =
  | { kind: 'attached' }
  | { kind: 'already-has-file' }
  | { kind: 'not-fetched'; message: string }
  | { kind: 'rejected'; message: string };

export type SaveResult = {
  results: ItemResult[];
  pdf: PdfOutcome | null;
  /** Null when no collection was chosen. */
  collection: 'added' | 'failed' | null;
  /** True when the site answered 401 part-way: the student signed out. */
  signedOut: boolean;
};

export type Request =
  | { type: 'theses' }
  | { type: 'collections'; documentId: string }
  | { type: 'create-collection'; documentId: string; name: string }
  | { type: 'save'; job: SaveJob };

/** Sent by the service worker while a save runs; the popup listens if it is still open. */
export type Progress = { type: 'progress'; runId: string; results: ItemResult[]; total: number };

/** `status` 0 means the site could not be reached at all. */
export type Failure = { ok: false; status: number; message: string };

export type Reply<T> = { ok: true; value: T } | Failure;
