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
