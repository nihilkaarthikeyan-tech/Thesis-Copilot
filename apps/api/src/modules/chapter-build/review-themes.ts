/**
 * The themes a literature review build proposes — ADR-0124. Planned in code, with no model call
 * and no unit: the literature chapter's own outline subsections first (the student's plan, with
 * their scope notes and subheadings), then the themes the literature search found
 * (`DocumentMemory.gapMap`, A.8), well-covered ones first. The student edits the list before
 * anything is charged; whatever is left is what the build writes, one section each.
 */

import { LIT_REVIEW_MAX_THEMES, type LitReviewTheme, type OutlineNode } from '@tc/types';

/**
 * Outline subsections the literature blueprint already writes as an element of its own (the
 * review's introduction, the framework, the gap analysis, the link to the objectives, the
 * summary). Narrow on purpose: "Band gap engineering" or "Regulatory framework" are themes.
 */
const BLUEPRINT_ELEMENT = [
  /^(?:\d[\d.]*\s*)?(?:introduction|scope (?:of|and)\b|search strategy|review methodology|methodology of the review)/i,
  /\b(?:theoretical|conceptual)(?: and conceptual)? framework/i,
  /^(?:\d[\d.]*\s*)?(?:critical\s+)?(?:research\s+)?gaps?\b|\bresearch gaps?\b|\bgap analysis\b/i,
  /^(?:\d[\d.]*\s*)?(?:chapter\s+)?(?:summary|conclusions?|concluding remarks)\b/i,
  /\blink to (?:the )?objectives\b|^(?:\d[\d.]*\s*)?(?:research\s+)?objectives\b/i,
];

const key = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** The same theme said twice: equal, or one a long-enough part of the other. */
function sameTheme(a: string, b: string): boolean {
  const x = key(a);
  const y = key(b);
  if (x === y) return true;
  return x.length > 6 && y.length > 6 && (x.includes(y) || y.includes(x));
}

type GapTheme = { name: string; count: number; thin: boolean };

/** The literature search's themes, as A.8 stored them; "Other" is not a theme. */
export function gapMapThemes(gapMap: unknown): GapTheme[] {
  const raw = (gapMap as { themes?: unknown } | null)?.themes;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t) => {
      const theme = (t ?? {}) as { name?: unknown; count?: unknown; thin?: unknown };
      return {
        name: typeof theme.name === 'string' ? theme.name.trim() : '',
        count: typeof theme.count === 'number' ? theme.count : 0,
        thin: theme.thin === true,
      };
    })
    .filter((t) => t.name.length > 0 && !/^other$/i.test(t.name))
    .sort((a, b) => Number(a.thin) - Number(b.thin) || b.count - a.count);
}

export function suggestReviewThemes(
  outlineChildren: readonly OutlineNode[],
  gapMap: unknown,
): LitReviewTheme[] {
  const themes: Array<Omit<LitReviewTheme, 'id'>> = [];
  for (const child of outlineChildren) {
    const title = child.title.trim();
    if (!title || BLUEPRINT_ELEMENT.some((re) => re.test(title))) continue;
    if (themes.some((t) => sameTheme(t.title, title))) continue;
    themes.push({
      title,
      note: child.scopeNote.trim(),
      outlineNodeId: child.id,
      children: child.children
        .filter((c) => c.title.trim().length > 0)
        .map((c) => ({ title: c.title.trim(), scopeNote: c.scopeNote.trim() })),
      from: 'outline',
    });
  }
  for (const found of gapMapThemes(gapMap)) {
    if (themes.length >= LIT_REVIEW_MAX_THEMES) break;
    if (themes.some((t) => sameTheme(t.title, found.name))) continue;
    themes.push({
      title: found.name,
      note: '',
      outlineNodeId: null,
      children: [],
      from: 'library',
    });
  }
  return themes.slice(0, LIT_REVIEW_MAX_THEMES).map((t, i) => ({ id: `t${i + 1}`, ...t }));
}
