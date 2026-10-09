/**
 * "Search the literature" on an AI edit — ADR-0133. The pure half shared by the API (which runs
 * it) and `apps/worker/scripts/edit-literature-relevance.ts` (which measured it): what the indexes
 * are asked, what a found abstract is scored against, and which found papers are kept.
 *
 * The first real run (2026-10-09) asked the keyword indexes with the instruction's words ("add
 * evidence published studies claim …") ahead of the subject's, scored everything against the
 * instruction too, and kept two barely related papers at the fixed 0.60 line. So:
 * - **the subject is the selection** (and the thesis and chapter when they name one); the
 *   instruction says what to do, not what about, and is used for search only when the selection
 *   alone gives too few words;
 * - **relevance is measured against the subject**, never the instruction;
 * - **the line is relative to the best match as well as absolute** (numbers in ADR-0133).
 */

import { keywordsOf } from './keywords.js';
import type { ResearchPlan } from './research.js';

/** Words an edit instruction uses that describe the editing, not the subject. */
const EDIT_NOISE = new Set(
  (
    'add adding addition include including insert give provide support supporting back cite ' +
    'citing citation citations reference references source sources claim claims sentence ' +
    'sentences paragraph paragraphs each every one two three published peer-reviewed recent ' +
    'example examples rewrite expand explain argument counter counter-argument mention ' +
    'discuss more less make better stronger clearer academic formal'
  ).split(' '),
);

/** The text without citation markers and maths, one line. */
export function plainSelection(selection: string): string {
  return selection
    .replace(/\{\{cite:[^}]+\}\}/g, ' ')
    .replace(/\$\$[^$]*\$\$|\$[^$\n]*\$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A title that names nothing: "Untitled thesis", "Chapter 2", "New document". */
export function namesNothing(title: string | null | undefined): boolean {
  const t = (title ?? '').trim();
  if (!t) return true;
  if (/^(untitled|new|my)(\s+(thesis|dissertation|document|chapter))?$/i.test(t)) return true;
  if (/^chapter\s+\d+$/i.test(t)) return true;
  return false;
}

/**
 * What the thesis is about, from what names it: the working or document title, the chapter's
 * title and its scope note. Empty for an untitled thesis with an unnamed chapter.
 */
export function editSearchContext(input: {
  thesisTitle?: string | null;
  chapterTitle?: string | null;
  scopeNote?: string | null;
}): string {
  return [
    namesNothing(input.thesisTitle) ? '' : (input.thesisTitle ?? ''),
    namesNothing(input.chapterTitle) ? '' : (input.chapterTitle ?? ''),
    input.scopeNote ?? '',
  ]
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('. ')
    .slice(0, 600);
}

export type EditSearchPlan = ResearchPlan & {
  /** What every found abstract is scored against: the context and the selection. */
  relevance: string;
};

/**
 * The searches for one edit, without a model.
 * - **Keyword**: the selection's content words (eight, then the first four), with the
 *   instruction's added only when the selection gives fewer than three.
 * - **Semantic** (OpenAlex): the context, the selection, then the instruction.
 * - **Relevance**: the context and the selection.
 */
export function editSearchPlan(input: {
  selection: string;
  instruction?: string | null;
  context?: string | null;
}): EditSearchPlan {
  const subject = plainSelection(input.selection);
  const asked = (input.instruction ?? '').replace(/\s+/g, ' ').trim();
  const context = (input.context ?? '').trim();
  let words = keywordsOf(subject, 8, EDIT_NOISE);
  if (words.length < 3) {
    words = [...words, ...keywordsOf(asked, 8, EDIT_NOISE).filter((w) => !words.includes(w))].slice(
      0,
      8,
    );
  }
  const full = words.join(' ');
  const short = words.length > 4 ? words.slice(0, 4).join(' ') : '';
  const keyword = [full, short].filter((q, i, all) => q.length > 0 && all.indexOf(q) === i);
  return {
    semantic: [context, subject, asked].filter(Boolean).join('. ').slice(0, 2_000),
    keyword,
    relevance: [context, subject].filter(Boolean).join('. ').slice(0, 2_000),
  };
}

export const EDIT_SEARCH = {
  /** Found papers added by one edit, at most. */
  maxPapers: 5,
  /**
   * Measured 2026-10-09 (`apps/worker/scripts/edit-literature-relevance.ts`, voyage-4, ten
   * selection/instruction pairs in ten fields; ADR-0133 has the table): every paper a reader would
   * call on the passage scored 0.68–0.89 against context + selection; the off-field ones 0.45–0.65
   * (biomass stoves, leachate sludge, plastic pavers, classroom acoustics); the live run's
   * "Solar photovoltaics to improve primary health care" 0.574 (0.615 on the first version's
   * measure, which the 0.60 line let in).
   */
  floor: 0.66,
  /**
   * And within this of the best paper found: where the indexes answer well, a paper 0.1 below the
   * best is the one about a neighbouring question ("Anaemia in pregnancy" at 0.690 under 0.890).
   */
  margin: 0.1,
} as const;

/**
 * The found papers to keep: at or above `floor`, and within `margin` of the best one found —
 * best first, `max` at most. Generic over what carries the cosine.
 */
export function keepRelevant<T extends { cosine: number }>(
  scored: readonly T[],
  rule: { floor: number; margin: number; max: number } = {
    floor: EDIT_SEARCH.floor,
    margin: EDIT_SEARCH.margin,
    max: EDIT_SEARCH.maxPapers,
  },
): T[] {
  const best = scored.reduce((m, s) => Math.max(m, s.cosine), 0);
  return [...scored]
    .filter((s) => s.cosine >= rule.floor && s.cosine >= best - rule.margin)
    .sort((a, b) => b.cosine - a.cosine)
    .slice(0, rule.max);
}
