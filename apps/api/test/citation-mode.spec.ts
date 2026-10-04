/**
 * ADR-0055: linked citations and Word citation fields are for the `.docx` download only. The PDF
 * is converted from the plain file, because LibreOffice redraws a Word `BIBLIOGRAPHY` field as its
 * own index (see `citation-mode.ts`).
 */

import { describe, expect, it } from 'vitest';
import { citationModeFor } from '../src/modules/export/citation-mode.js';

describe('the citation mode an export is built with', () => {
  it('is what the student chose, for the .docx', () => {
    expect(citationModeFor('docx', 'word')).toBe('word');
    expect(citationModeFor('docx', 'linked')).toBe('linked');
    expect(citationModeFor('docx', undefined)).toBe('plain');
  });

  it('is always plain for the PDF and every other format', () => {
    for (const format of ['pdf', 'latex', 'html']) {
      expect(citationModeFor(format, 'word')).toBe('plain');
      expect(citationModeFor(format, 'linked')).toBe('plain');
    }
  });
});
