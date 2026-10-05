/**
 * The outline tree — PRD §10.7.2, verbatim:
 *
 *   { id: string; title: string; scopeNote: string; subTheme?: string;
 *     mappedFromPaperSection?: string; children: OutlineNode[] }
 *
 * `DocumentMemory.outline` holds an `OutlineNode[]`. FR-3.4 is explicit that the tree UI and the
 * prompt builder read the same record, so this schema is the only definition of that shape and
 * both sides validate against it.
 */

import { z } from 'zod';
import type { PaperExtraction } from './extraction.js';

export type OutlineNode = {
  id: string;
  title: string;
  scopeNote: string;
  subTheme?: string;
  mappedFromPaperSection?: string;
  children: OutlineNode[];
};

/** Recursive, so `z.lazy` is required; the explicit type annotation is what makes it compile. */
export const outlineNodeSchema: z.ZodType<OutlineNode> = z.lazy(() =>
  z.object({
    id: z.string().trim().min(1),
    title: z.string().trim().min(1),
    scopeNote: z.string().trim(),
    // `.nullish()`, not `.optional()`, because A.9 asks the model for
    // `"subTheme": string|null` in as many words. A model that does exactly what the prompt says
    // sent `null`, `.optional()` rejected it, and the whole outline failed to parse — which is
    // how outline generation broke against the first real model it ever met
    // (`pnpm ai:shakedown`, 2026-09-14). The mock omitted the keys entirely, so nothing caught it.
    // Normalised back to `undefined` so `OutlineNode` keeps one spelling for "absent".
    subTheme: z
      .string()
      .trim()
      .min(1)
      .nullish()
      .transform((v) => v ?? undefined),
    mappedFromPaperSection: z
      .string()
      .trim()
      .min(1)
      .nullish()
      .transform((v) => v ?? undefined),
    children: z.array(outlineNodeSchema).default([]),
  }),
);

export const outlineSchema = z.array(outlineNodeSchema);

/** Depth-first walk, which is the order the outline renders and the prompt builder serialises in. */
export function walkOutline(nodes: readonly OutlineNode[]): OutlineNode[] {
  const flat: OutlineNode[] = [];
  const visit = (list: readonly OutlineNode[]): void => {
    for (const node of list) {
      flat.push(node);
      visit(node.children);
    }
  };
  visit(nodes);
  return flat;
}

export function findOutlineNode(
  nodes: readonly OutlineNode[],
  id: string,
): OutlineNode | undefined {
  return walkOutline(nodes).find((node) => node.id === id);
}

/** Parses whatever is stored in `DocumentMemory.outline`, treating anything invalid as empty. */
export function readOutline(value: unknown): OutlineNode[] {
  const parsed = outlineSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

/**
 * A slug that is stable for the same heading, so re-running this on an unchanged paper produces
 * the same node ids and `Chapter.outlineNodeId` keeps pointing at the right node.
 */
export function outlineNodeId(title: string, index: number): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug ? `${index + 1}-${slug}` : `${index + 1}`;
}

/** PHASES 3.1 asks for one chapter to start with; the outline grows in Phase 2 (FR-3.2). */
export const DEFAULT_CHAPTER_TITLE = 'Chapter 1 — Introduction';

/**
 * The minimal outline PHASES 3.1 describes:
 *
 *   "create one `Chapter` ('Chapter 1 — Introduction' or the first section from the paper's
 *    `sections`) with `scopeNote` from the extraction's first section summary;
 *    `DocumentMemory.outline` = a one-node tree."
 *
 * FR-3.3 says Path B "maps the paper's sections onto thesis chapters … rather than inventing
 * structure", so the title and the scope note are the paper's own words where the paper has them,
 * and a neutral default where it does not. Nothing here is generated.
 */
export function firstChapterOutline(
  extraction: PaperExtraction | null | undefined,
  workingTitle?: string,
): OutlineNode {
  const section = extraction?.sections?.find(
    (candidate) => candidate.heading.trim().length > 0 && !isFrontOrBackMatter(candidate.heading),
  );

  const title = section?.heading.trim() || DEFAULT_CHAPTER_TITLE;
  // The scope note is what every later prompt reads as "what this chapter is about", so it falls
  // back through the paper's own summary, then its abstract, then the student's own scope.
  const scopeNote =
    section?.summary.trim() ||
    extraction?.abstract?.trim() ||
    (workingTitle ? `Introduces the thesis: ${workingTitle}.` : '');

  return {
    id: outlineNodeId(title, 0),
    title,
    scopeNote,
    children: [],
    ...(section ? { mappedFromPaperSection: section.heading.trim() } : {}),
  };
}

/**
 * Headings that are not chapters. A paper's abstract, keywords and acknowledgements are front
 * matter and its reference list is back matter; a thesis restates none of them as a chapter, and
 * naming the first chapter "Abstract" is worse than falling back to a neutral default.
 */
function isFrontOrBackMatter(heading: string): boolean {
  return /^\s*(abstract|keywords?|highlights|acknowledge?ments?|author contributions|declarations?|funding|conflicts? of interest|references|bibliography|works cited|literature cited|appendix|supplementary)\b/i.test(
    heading,
  );
}

/** A heading's words without its number or punctuation: "2.1 Cost barriers." → "cost barriers". */
const headingKey = (title: string): string =>
  title
    .toLowerCase()
    // A Roman numeral only with its full stop, or "civil engineering" would lose "civil".
    .replace(/^\s*(?:chapter\s+)?(?:\d+(?:\.\d+)*[.):]?|[ivxlc]+[.)])\s+/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * The outline section the cursor is writing under (2026-10-04, from the Jenni study: fix list A21).
 * `heading` is the nearest heading above the cursor in the chapter; the match is on its words,
 * so a student renumbering "2.1" or adding a full stop still finds the section. Only the chapter's
 * own sub-sections are searched, and nothing is returned for the chapter heading itself.
 */
export function sectionUnderHeading(
  chapterNode: OutlineNode | undefined,
  heading: string | undefined,
): OutlineNode | undefined {
  const key = heading ? headingKey(heading) : '';
  if (!chapterNode || !key) return undefined;
  return walkOutline(chapterNode.children).find((node) => headingKey(node.title) === key);
}

/**
 * The scope note Assist reads: the chapter's, then the section's under the cursor when it has
 * one. Data in the existing scope-note slot, not new prompt wording.
 */
export function scopeWithSection(
  chapterScope: string | null | undefined,
  section: OutlineNode | undefined,
): string | null {
  const note = section?.scopeNote.trim();
  if (!note) return chapterScope ?? null;
  const sectionLine = `This section, "${section?.title}": ${note}`;
  return chapterScope?.trim() ? `${chapterScope.trim()}\n${sectionLine}` : sectionLine;
}

/**
 * A section title that names no topic (ADR-0071): "Chapter 1", "Section 2", "Untitled", or
 * nothing. Draft mode refuses to write for one of these without a scope note, and asks the
 * student for a heading instead, rather than drafting about whatever the passages happen to be.
 */
export function isGenericSectionTitle(title: string | null | undefined): boolean {
  const t = (title ?? '').replace(/^#+\s*/, '').trim();
  if (t.length === 0) return true;
  if (/^untitled\b/i.test(t)) return true;
  return /^(chapter|section|part|unit)\s*[0-9ivxlc.]*$/i.test(t);
}
