/**
 * Upload validation — PRD §12.1 ("MIME + magic-byte check; size limits per plan") and §11.3
 * (FREE_TRIAL 25 MB / 150 pages, STUDENT plans 50 MB / 500 pages).
 *
 * Pure functions so the rules are testable without a request, a database or object storage.
 *
 * A file's declared name and content type both come from the client and are worth nothing on their
 * own, so the bytes decide. PRD §12.1 also forbids executing or rendering an upload server-side
 * except through `unpdf`, which is why nothing here parses the file.
 */

import { PLAN_LIMITS, type Plan } from '@tc/config';

export type UploadKind = 'pdf' | 'docx';

/** Reasons an upload is refused, as stable slugs the web app can switch on. */
export type UploadRejection =
  | 'EMPTY_FILE'
  | 'UNSUPPORTED_TYPE'
  | 'CONTENT_MISMATCH'
  | 'TOO_LARGE'
  | 'TOO_MANY_PAGES'
  | 'QUOTA_EXCEEDED';

export type UploadCheck =
  | { ok: true; kind: UploadKind }
  | { ok: false; reason: UploadRejection; detail: string };

/** `%PDF-` */
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];
/** `PK\x03\x04` — a .docx is a zip container. */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((byte, i) => bytes[i] === byte);
}

/** The kind the bytes actually are, ignoring the filename and the declared content type. */
export function sniffKind(bytes: Uint8Array): UploadKind | null {
  if (startsWith(bytes, PDF_MAGIC)) return 'pdf';
  // Every zip is a candidate .docx; mammoth rejects a zip that is not one.
  if (startsWith(bytes, ZIP_MAGIC)) return 'docx';
  return null;
}

/** The kind the filename claims. Used only to detect a mismatch with the bytes. */
export function kindFromFilename(filename: string): UploadKind | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.docx')) return 'docx';
  return null;
}

export function checkUpload(input: {
  filename: string;
  bytes: Uint8Array;
  plan: Plan;
}): UploadCheck {
  const limits = PLAN_LIMITS[input.plan];

  if (input.bytes.length === 0) {
    return { ok: false, reason: 'EMPTY_FILE', detail: 'That file is empty.' };
  }

  const claimed = kindFromFilename(input.filename);
  if (claimed === null) {
    return {
      ok: false,
      reason: 'UNSUPPORTED_TYPE',
      detail: 'Upload a .pdf or a .docx file.',
    };
  }

  const actual = sniffKind(input.bytes);
  if (actual === null) {
    return {
      ok: false,
      reason: 'CONTENT_MISMATCH',
      detail: 'That file is not a readable PDF or Word document.',
    };
  }
  if (actual !== claimed) {
    return {
      ok: false,
      reason: 'CONTENT_MISMATCH',
      detail: `That file is named .${claimed} but its contents are a ${actual === 'pdf' ? 'PDF' : 'Word document'}.`,
    };
  }

  if (input.bytes.length > limits.pdfMaxBytes) {
    const mb = (n: number) => Math.round(n / (1024 * 1024));
    return {
      ok: false,
      reason: 'TOO_LARGE',
      detail: `That file is ${mb(input.bytes.length)} MB. Your plan allows ${mb(limits.pdfMaxBytes)} MB.`,
    };
  }

  return { ok: true, kind: actual };
}

/** Page limit, checked after parsing since the count is not in the header (PRD §11.3). */
export function checkPageCount(pages: number, plan: Plan): UploadCheck | { ok: true } {
  const limits = PLAN_LIMITS[plan];
  if (pages > limits.pdfMaxPages) {
    return {
      ok: false,
      reason: 'TOO_MANY_PAGES',
      detail: `That document has ${pages} pages. Your plan allows ${limits.pdfMaxPages}.`,
    };
  }
  return { ok: true };
}

/** Seed-paper quota — PRD §11.3 (FREE_TRIAL 1, STUDENT 3) and FR-1.1 (1–3 files). */
export function checkSeedPaperQuota(existing: number, plan: Plan): UploadCheck | { ok: true } {
  const allowed = PLAN_LIMITS[plan].seedPapers;
  if (existing >= allowed) {
    return {
      ok: false,
      reason: 'QUOTA_EXCEEDED',
      detail: `Your plan allows ${allowed} seed paper${allowed === 1 ? '' : 's'} per thesis.`,
    };
  }
  return { ok: true };
}

/** Library PDF quota — PRD §11.3 (FREE_TRIAL 10, STUDENT 60). */
export function checkLibraryQuota(existing: number, plan: Plan): UploadCheck | { ok: true } {
  const allowed = PLAN_LIMITS[plan].libraryPdfs;
  if (existing >= allowed) {
    return {
      ok: false,
      reason: 'QUOTA_EXCEEDED',
      detail: `Your plan allows ${allowed} library PDFs.`,
    };
  }
  return { ok: true };
}

/** Object-storage key for a seed paper. Scoped by document so a listing cannot cross theses. */
export function seedPaperKey(documentId: string, seedPaperId: string, kind: UploadKind): string {
  return `seed-papers/${documentId}/${seedPaperId}.${kind}`;
}

/** Object-storage key for a library source PDF. */
export function sourceFileKey(documentId: string, sourceId: string): string {
  return `sources/${documentId}/${sourceId}.pdf`;
}
