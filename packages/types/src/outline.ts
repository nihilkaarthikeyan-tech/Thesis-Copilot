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
    subTheme: z.string().trim().min(1).optional(),
    mappedFromPaperSection: z.string().trim().min(1).optional(),
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
