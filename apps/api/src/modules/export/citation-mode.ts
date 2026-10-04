/**
 * Which citation mode an export is built with — ADR-0055.
 *
 * Only the `.docx` download carries linked citations or Word's citation fields. The PDF is always
 * converted from the plain file: LibreOffice (inside Gotenberg) reads a Word `BIBLIOGRAPHY` field
 * as its own bibliography index and fills it with its own entries — measured on 2026-10-04, the
 * references list came out as "Kumar, 2021: , (Kumar, 2021)," — so what a student hands in must
 * never depend on how LibreOffice reads a Word field.
 */

import type { CitationMode } from '@tc/types';

export function citationModeFor(format: string, requested: CitationMode | undefined): CitationMode {
  return format === 'docx' ? (requested ?? 'plain') : 'plain';
}
