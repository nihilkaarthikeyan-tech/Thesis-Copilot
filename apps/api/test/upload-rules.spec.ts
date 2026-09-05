/**
 * Upload validation — PRD §12.1 (MIME + magic-byte check, size limits per plan) and §11.3.
 *
 * These are the checks that stand between a student's upload and the parser, so they are tested
 * for what they refuse as much as for what they let through.
 */

import { describe, expect, it } from 'vitest';
import {
  checkLibraryQuota,
  checkPageCount,
  checkSeedPaperQuota,
  checkUpload,
  kindFromFilename,
  seedPaperKey,
  sniffKind,
  sourceFileKey,
} from '../src/modules/sources/upload-rules.js';

const bytesOf = (prefix: readonly number[], size = 1024): Uint8Array => {
  const out = new Uint8Array(size);
  out.set(prefix, 0);
  return out;
};

const PDF = () => bytesOf([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
const DOCX = () => bytesOf([0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04
const EXE = () => bytesOf([0x4d, 0x5a, 0x90, 0x00]); // MZ — a Windows executable

describe('sniffKind', () => {
  it('recognises a PDF and a zip-based docx by their magic bytes', () => {
    expect(sniffKind(PDF())).toBe('pdf');
    expect(sniffKind(DOCX())).toBe('docx');
  });

  it('recognises nothing else', () => {
    expect(sniffKind(EXE())).toBeNull();
    expect(sniffKind(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(sniffKind(new Uint8Array())).toBeNull();
  });
});

describe('kindFromFilename', () => {
  it.each([
    ['paper.pdf', 'pdf'],
    ['PAPER.PDF', 'pdf'],
    ['manuscript.docx', 'docx'],
    ['notes.txt', null],
    ['nodots', null],
  ])('%s → %s', (name, expected) => {
    expect(kindFromFilename(name)).toBe(expected);
  });
});

describe('checkUpload', () => {
  it('accepts a PDF named .pdf', () => {
    expect(checkUpload({ filename: 'p01.pdf', bytes: PDF(), plan: 'FREE_TRIAL' })).toEqual({
      ok: true,
      kind: 'pdf',
    });
  });

  it('accepts a docx named .docx', () => {
    expect(checkUpload({ filename: 'p05.docx', bytes: DOCX(), plan: 'STUDENT_MONTHLY' })).toEqual({
      ok: true,
      kind: 'docx',
    });
  });

  it('refuses an executable renamed .pdf — the bytes decide, not the name', () => {
    const result = checkUpload({ filename: 'evil.pdf', bytes: EXE(), plan: 'FREE_TRIAL' });
    expect(result).toMatchObject({ ok: false, reason: 'CONTENT_MISMATCH' });
  });

  it('refuses a PDF renamed .docx', () => {
    const result = checkUpload({ filename: 'paper.docx', bytes: PDF(), plan: 'FREE_TRIAL' });
    expect(result).toMatchObject({ ok: false, reason: 'CONTENT_MISMATCH' });
    if (!result.ok) expect(result.detail).toContain('PDF');
  });

  it('refuses an unsupported extension before looking at the bytes', () => {
    expect(checkUpload({ filename: 'notes.txt', bytes: PDF(), plan: 'FREE_TRIAL' })).toMatchObject({
      ok: false,
      reason: 'UNSUPPORTED_TYPE',
    });
  });

  it('refuses an empty file', () => {
    expect(
      checkUpload({ filename: 'p01.pdf', bytes: new Uint8Array(), plan: 'FREE_TRIAL' }),
    ).toMatchObject({ ok: false, reason: 'EMPTY_FILE' });
  });

  describe('size limits per plan (§11.3)', () => {
    it('FREE_TRIAL stops at 25 MB', () => {
      const over = bytesOf([0x25, 0x50, 0x44, 0x46, 0x2d], 26 * 1024 * 1024);
      const result = checkUpload({ filename: 'p.pdf', bytes: over, plan: 'FREE_TRIAL' });
      expect(result).toMatchObject({ ok: false, reason: 'TOO_LARGE' });
      if (!result.ok) expect(result.detail).toContain('25 MB');
    });

    it('a STUDENT plan allows the same file, up to 50 MB', () => {
      const size26 = bytesOf([0x25, 0x50, 0x44, 0x46, 0x2d], 26 * 1024 * 1024);
      expect(checkUpload({ filename: 'p.pdf', bytes: size26, plan: 'STUDENT_MONTHLY' }).ok).toBe(
        true,
      );

      const size51 = bytesOf([0x25, 0x50, 0x44, 0x46, 0x2d], 51 * 1024 * 1024);
      expect(
        checkUpload({ filename: 'p.pdf', bytes: size51, plan: 'STUDENT_MONTHLY' }),
      ).toMatchObject({ ok: false, reason: 'TOO_LARGE' });
    });
  });
});

describe('checkPageCount (§11.3)', () => {
  it('FREE_TRIAL stops at 150 pages', () => {
    expect(checkPageCount(150, 'FREE_TRIAL').ok).toBe(true);
    const over = checkPageCount(151, 'FREE_TRIAL');
    expect(over).toMatchObject({ ok: false, reason: 'TOO_MANY_PAGES' });
  });

  it('a STUDENT plan stops at 500', () => {
    expect(checkPageCount(500, 'STUDENT_ANNUAL').ok).toBe(true);
    expect(checkPageCount(501, 'STUDENT_ANNUAL').ok).toBe(false);
  });
});

describe('quotas (§11.3, FR-1.1)', () => {
  it('FREE_TRIAL allows one seed paper, a STUDENT plan three', () => {
    expect(checkSeedPaperQuota(0, 'FREE_TRIAL').ok).toBe(true);
    expect(checkSeedPaperQuota(1, 'FREE_TRIAL').ok).toBe(false);
    expect(checkSeedPaperQuota(2, 'STUDENT_MONTHLY').ok).toBe(true);
    expect(checkSeedPaperQuota(3, 'STUDENT_MONTHLY').ok).toBe(false);
  });

  it('says how many the plan allows, in the singular where that reads better', () => {
    const result = checkSeedPaperQuota(1, 'FREE_TRIAL');
    if (!result.ok) expect(result.detail).toContain('1 seed paper per thesis');
  });

  it('library PDFs are 10 on FREE_TRIAL and 60 on a STUDENT plan', () => {
    expect(checkLibraryQuota(9, 'FREE_TRIAL').ok).toBe(true);
    expect(checkLibraryQuota(10, 'FREE_TRIAL').ok).toBe(false);
    expect(checkLibraryQuota(59, 'STUDENT_MONTHLY').ok).toBe(true);
    expect(checkLibraryQuota(60, 'STUDENT_MONTHLY').ok).toBe(false);
  });
});

describe('object-storage keys', () => {
  it('scopes a seed paper by document, so a listing cannot cross theses', () => {
    expect(seedPaperKey('doc-1', 'sp-2', 'pdf')).toBe('seed-papers/doc-1/sp-2.pdf');
    expect(seedPaperKey('doc-1', 'sp-3', 'docx')).toBe('seed-papers/doc-1/sp-3.docx');
  });

  it('scopes a source file by document too', () => {
    expect(sourceFileKey('doc-1', 'src-9')).toBe('sources/doc-1/src-9.pdf');
  });
});
