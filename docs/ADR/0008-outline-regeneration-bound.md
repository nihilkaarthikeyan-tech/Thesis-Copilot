# 0008 — Per-section outline regeneration needs its own bound

Date: 2026-09-07
Status: accepted
Supersedes: nothing. Amends the reasoning in PRD §11.4 for the `OUTLINE` action.

## Context

PRD §11.3 gives monthly caps to six actions. `OUTLINE` is not one of them. §11.4 explains why:
it is a **once-per-document** operation, so it is amortised into the monthly budget as a fixed
line rather than metered per call. `packages/config/src/actions.ts` records that reasoning in
`UNMETERED_ACTIONS`, and `computeMonthlyBudget` charges exactly one `OUTLINE` call per document.

FR-3.6 — "per-section scope regeneration with sibling context", built in Phase 3 Block 3 —
breaks that assumption. `POST /documents/:id/outline/:nodeId/regenerate` is a Strong-tier call a
student can make on any section, as often as they like. As first written it had no cap and no
bound: a student could spend indefinitely on the Strong tier.

That collides with the hard constraint in §11: *a feature that cannot be metered and capped does
not ship.*

## Decision

Bound `OUTLINE` calls per **document** rather than adding a monthly cap.

- `OUTLINE_CALLS_PER_DOCUMENT = 12` in `packages/config/src/cost.ts` — the first generation plus
  eleven rewrites. `OutlineService.regenerateSection` counts this document's `AiCallLog` rows for
  `OUTLINE` and refuses past the bound.
- A new `ONE_TIME_PROFILES.OUTLINE_SECTION` profile prices a regeneration honestly: one chapter
  and its siblings in, one scope note out, far smaller than a whole outline.
- `computeMonthlyBudget` now pays for **every** call the bound allows, as if the student used all
  of them. The amortised one-time line goes from ₹2.94 to ₹6.81; the FREE_TRIAL total goes from
  ₹32.90 to ₹36.77 against the ₹100 ceiling.

A per-document bound rather than a monthly cap because it keeps §11.4's frame: `OUTLINE` is still
a document-lifecycle operation, bounded the way `EXTRACT` is bounded by seed-paper count. It also
fails in the right place — a student who has rewritten one thesis's outline twelve times has an
outline problem, not a quota problem, and the refusal says so and points at the editable tree.

## Consequences

- `OUTLINE` stays in `UNMETERED_ACTIONS`; the E.2 completeness assertion is unchanged.
- The refusal is not a cap error and does not appear in `/usage/me`. A student who hits it sees a
  plain sentence, not a meter.
- The budget model now over-charges the common case (most documents will use one or two calls).
  That is the right direction for a ₹100 ceiling: the ceiling has to hold for the heaviest user
  the bound permits, not the average one.
