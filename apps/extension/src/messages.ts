/**
 * What the popup and the in-page buttons ask the service worker, and what it answers (ADR-0031,
 * ADR-0069, ADR-0125).
 *
 * The requests to Thesis Copilot are made by the service worker, not the popup: a popup closes the
 * moment the student clicks anywhere else, and a request started there would be cut off with it.
 * A bulk save keeps going in the service worker after the popup closes, and reports its progress
 * to the popup while it is open.
 */

import type { Paper } from './paper.js';
import type { PaperRef } from './refs.js';

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

/**
 * One paper from an in-page button (ADR-0125). With a `ref`, it goes in through the library's
 * paste-an-ID import, which reads the record again on the server; without one (a Scholar result
 * that names no DOI, or an identifier the lookup found no record for) it goes the popup's way,
 * through resolve, by its details.
 */
export type SaveOneJob = {
  documentId: string;
  collectionId: string | null;
  ref: PaperRef | null;
  paper: Paper;
};

/** What `lookup-id` found, as the add-on keeps it: every field checked, nothing invented. */
export type Preview = {
  kind: 'doi' | 'arxiv' | 'pmid';
  title: string;
  byline: string | null;
  year: number | null;
  venue: string | null;
  doi: string | null;
  /** Crossref's count of works citing it — only when the lookup was by DOI and Crossref said. */
  citedBy: number | null;
  /** Where it is free to read, when the record says so: arXiv, or a PubMed Central copy. */
  openAccessVia: 'arXiv' | 'PubMed Central' | null;
};

export type SaveOneResult = ItemResult & {
  collection: 'added' | 'failed' | null;
  /** True when the site answered 401: the student signed out. */
  signedOut: boolean;
  /** How it went in: by its identifier (`import-id`), or by its details (`resolve`). */
  via: 'id' | 'details';
};

export type Request =
  | { type: 'theses' }
  | { type: 'collections'; documentId: string }
  | { type: 'create-collection'; documentId: string; name: string }
  | { type: 'save'; job: SaveJob }
  /** The in-page card: what the library finds for one identifier (`lookup-id`). Free. */
  | { type: 'lookup'; documentId: string; ref: PaperRef }
  | { type: 'save-one'; job: SaveOneJob };

/** What a content script may ask. Everything else is for the add-on's own pages. */
export const INPAGE_REQUESTS: ReadonlyArray<Request['type']> = [
  'theses',
  'collections',
  'lookup',
  'save-one',
];

/** Sent by the service worker while a save runs; the popup listens if it is still open. */
export type Progress = { type: 'progress'; runId: string; results: ItemResult[]; total: number };

/** `status` 0 means the site could not be reached at all. */
export type Failure = { ok: false; status: number; message: string };

export type Reply<T> = { ok: true; value: T } | Failure;
