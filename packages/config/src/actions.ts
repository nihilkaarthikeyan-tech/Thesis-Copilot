/**
 * AI actions and which of them are metered.
 *
 * Source of truth: PRD §8 (`enum AiAction`) and §11.3 (plan caps).
 * This list MUST stay identical to the `AiAction` enum in `packages/db/prisma/schema.prisma`.
 * `packages/db` has a test that asserts the two agree.
 */

export const AI_ACTIONS = [
  'ASSIST',
  'DRAFT',
  'CITE',
  'CHAT',
  'COMMAND',
  'EXTRACT',
  'OUTLINE',
  'STYLE_PROFILE',
  'SEARCH_QUERIES',
  'COHERENCE',
  'CLASSIFY_COMMENT',
  'SCOPED_REVISION',
  'PARSE_CITATION',
  'EMBED',
  // ADR-0005: the Path A conversation (A.6) and the cross-paper pass (A.16) had no value to log
  // under. Both are once-per-document Strong calls, bounded like EXTRACT (§11.4), not capped.
  'PROPOSAL',
  'CROSS_PAPER',
  // ADR-0030: viva preparation — a question set, or feedback on one typed answer.
  'VIVA',
  // ADR-0039: one planned, checked chapter, delivered as drafts the student accepts.
  'CHAPTER_BUILD',
  // ADR-0056: a strict examiner's reading of a chapter the student wrote, as flags.
  'EXAMINER_REVIEW',
  // ADR-0080: deep research in chat — a planned, searched, part-by-part answer the student asks
  // for by name; a planner call and a longer answer on the strong tier.
  'RESEARCH',
  // ADR-0124: the whole literature-review chapter from one press — the chapter build's pipeline
  // run over every theme of the review, delivered as drafts the student accepts.
  'LIT_REVIEW_BUILD',
] as const;

export type AiAction = (typeof AI_ACTIONS)[number];

/**
 * Actions with a per-user monthly cap (PRD §11.3). A metered action is refused when the cap is
 * reached, before any provider call is made (§11.5).
 */
export const METERED_ACTIONS = [
  'ASSIST',
  'DRAFT',
  'CITE',
  'CHAT',
  'COMMAND',
  'COHERENCE',
  // ADR-0030. Not in §11.3: its cap is set there, and priced at the configured models.
  'VIVA',
  // ADR-0039. One unit is one chapter build (up to 12 sections), priced the same way.
  'CHAPTER_BUILD',
  // ADR-0056. One unit is one examiner review of one chapter (up to 8 sections).
  'EXAMINER_REVIEW',
  // ADR-0080. One unit is one deep research question: the plan, every search, and the answer.
  'RESEARCH',
  // ADR-0124. One unit is one whole literature review (up to 20 sections). ADR-0143: one a month
  // on the paid plans, none on the trial; the flag is on.
  'LIT_REVIEW_BUILD',
] as const satisfies readonly AiAction[];

/** The six §11.3 rows — what the PRD's own budget table (§11.4) prices. */
export const PRD_METERED_ACTIONS = [
  'ASSIST',
  'DRAFT',
  'CITE',
  'CHAT',
  'COMMAND',
  'COHERENCE',
] as const satisfies readonly AiAction[];

export type MeteredAction = (typeof METERED_ACTIONS)[number];

/**
 * Actions PRD §11.3 gives no cap row for. They are bounded by a different limit — seed-paper and
 * library-PDF counts, or a once-per-document lifecycle — and are amortised into the monthly budget
 * as one-time operations (§11.4).
 *
 * PRD Appendix E.2 requires every `AiAction` used by an endpoint to have a cap in every plan.
 * §11.3 lists caps for six actions only, so the two cannot both hold. This list is the explicit
 * exemption that makes the completeness assertion meaningful instead of impossible: the E.2 test
 * asserts METERED ∪ UNMETERED covers every action exactly once, and that every metered action has
 * a cap in every plan. Logged in docs/BUILD_LOG.md and docs/CONSISTENCY_REVIEW.md for human review.
 */
export const UNMETERED_ACTIONS = [
  'EXTRACT',
  'OUTLINE',
  'STYLE_PROFILE',
  'SEARCH_QUERIES',
  'CLASSIFY_COMMENT',
  'SCOPED_REVISION',
  'PARSE_CITATION',
  'EMBED',
  'PROPOSAL',
  'CROSS_PAPER',
] as const satisfies readonly AiAction[];

export type UnmeteredAction = (typeof UNMETERED_ACTIONS)[number];

export function isMetered(action: AiAction): action is MeteredAction {
  return (METERED_ACTIONS as readonly AiAction[]).includes(action);
}

/** LLM tiers (PRD §10.1). `embed` is the embedding model, priced separately. */
export type Tier = 'fast' | 'strong';

/**
 * The monthly allowances in the student's words — the one source for every screen and for the
 * API's refusals, which until 2026-10-04 said "You have used all 0 COHERENCE actions".
 */
export const ALLOWANCE_NAMES: Readonly<Record<string, string>> = {
  ASSIST: 'Assist suggestions',
  DRAFT: 'Draft sections',
  CITE: 'Citation suggestions',
  CHAT: 'Questions to your library',
  COMMAND: 'Section commands',
  COHERENCE: 'Coherence checks',
  VIVA: 'Viva practice',
  CHAPTER_BUILD: 'Chapter builds',
  EXAMINER_REVIEW: 'Examiner reviews',
  RESEARCH: 'Deep research questions',
  LIT_REVIEW_BUILD: 'Literature review builds',
  // ADR-0072: not a metered action, but bounded per month, and refused in these words.
  OUTLINE_FROM_TITLE: 'Chapter plans from a title',
};

/** A refused metered action, said plainly: not on the plan at all, or used up this month. */
export function capRefusalDetail(action: string, cap: number): string {
  const name = ALLOWANCE_NAMES[action] ?? 'AI actions of this kind';
  if (cap <= 0) return `${name} are not included in your plan.`;
  return `You have used all ${cap} of this month's ${name.toLowerCase()}.`;
}
