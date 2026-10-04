/**
 * How citations are written into an exported `.docx` — ADR-0055.
 *
 *   - `plain`  — the label as text, exactly as before ADR-0055. The default.
 *   - `linked` — the same text, each in-text citation a link to its entry in the bibliography,
 *     which carries a bookmark. Works in Word, LibreOffice and Google Docs; nothing restyles.
 *   - `word`   — Word's own citations: every cited source in the document's source list, each
 *     in-text citation a `CITATION` field and the bibliography a `BIBLIOGRAPHY` field, all with our
 *     rendered text already in place. Word restyles and updates them from References.
 *
 * Only the `.docx` download honours it. The PDF is always built from the plain file, so what a
 * student hands in never depends on how LibreOffice reads a Word field.
 */

import { z } from 'zod';

export const CITATION_MODES = ['plain', 'linked', 'word'] as const;
export type CitationMode = (typeof CITATION_MODES)[number];

export const citationModeSchema = z.enum(CITATION_MODES);
