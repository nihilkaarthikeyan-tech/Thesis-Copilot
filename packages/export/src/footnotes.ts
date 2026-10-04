/**
 * Footnotes in the Word exports (2026-09-25).
 *
 * A footnote in the editor is an inline node holding its own text. In a `.docx` it becomes a real
 * Word footnote — a reference mark in the line and the note at the foot of the page, numbered by
 * Word — so the student's supervisor can edit it as one. `docx` takes the notes as a map on the
 * Document and a `FootnoteReferenceRun(id)` where each belongs; this collects the map while the
 * body is built, keyed on the export's own input object so two exports never share a counter.
 *
 * Numbering runs through the whole thesis in every format, as Word numbers by default.
 */

import { FootnoteReferenceRun, Paragraph, type ParagraphChild, TextRun } from 'docx';

type Node = { type?: string; attrs?: Record<string, unknown> };

export type Notes = { next: number; entries: Record<string, { children: Paragraph[] }> };

const registry = new WeakMap<object, Notes>();

export function notesFor(owner: object): Notes {
  let notes = registry.get(owner);
  if (!notes) {
    notes = { next: 1, entries: {} };
    registry.set(owner, notes);
  }
  return notes;
}

/** A footnote node's words, trimmed; an empty footnote still takes a number and says so. */
export function footnoteText(node: Node): string {
  const text = typeof node.attrs?.text === 'string' ? node.attrs.text.trim() : '';
  return text || '[empty footnote]';
}

/**
 * The reference mark for `node`, its note recorded against `owner`'s export. `children` replaces
 * the note's plain text run — a citation note linked to its bibliography entry (ADR-0055).
 */
export function footnoteRun(
  owner: object,
  node: Node,
  font?: { name: string; size: number },
  children?: ParagraphChild[],
): FootnoteReferenceRun {
  const notes = notesFor(owner);
  const id = notes.next++;
  notes.entries[String(id)] = {
    children: [
      new Paragraph({
        children: children ?? [
          new TextRun({
            text: footnoteText(node),
            ...(font ? { font: font.name, size: font.size } : {}),
          }),
        ],
      }),
    ],
  };
  return new FootnoteReferenceRun(id);
}
