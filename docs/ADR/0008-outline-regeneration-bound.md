# 0008 — Per-section outline regeneration is metered against the COMMAND cap

Date: 2026-09-07
Status: accepted
Amends: PRD §11.3 (the `COMMAND` cap), §11.2/§11.4 (the `COMMAND` unit cost), and the reasoning
in §11.4 for the `OUTLINE` action.

## Context

PRD §11.3 gives monthly caps to six actions. `OUTLINE` is not one of them, and §11.4 explains why:
it is a **once-per-document** operation, amortised into the monthly budget as a fixed line rather
than metered per call. `packages/config/src/actions.ts` records that in `UNMETERED_ACTIONS`, and
`computeMonthlyBudget` charges exactly one `OUTLINE` call per document.

FR-3.6 — "per-section scope regeneration with sibling context", built in Phase 3 Block 3 — breaks
that assumption. `POST /documents/:id/outline/:nodeId/regenerate` is a Strong-tier call a student
can make on any section, as often as they like. As first written it had no cap and no bound, which
collides with the hard constraint in §11: *a feature that cannot be metered and capped does not
ship.*

The first attempt at a fix was a per-document bound of twelve `OUTLINE` calls, paid for in the
one-time line. **The ceiling test rejected it**, and that is the more important finding: the
STUDENT plan already computes to **₹99.61** of the ₹100 ceiling before FR-3.6 exists. §11.4's own
table prints ≈₹95.8 using rounded unit costs; the exact rates leave ₹0.39. There is no room in
the budget for a new capped action, and any bound large enough to make per-section regeneration
useful costs more than that.

## Decision

Meter FR-3.6 against the existing **`COMMAND`** cap, and pay for it by lowering that cap.

- `OutlineService.regenerateSection` calls `usage.consume(userId, plan, 'COMMAND')` before the
  provider, and answers `CAP_EXCEEDED` when it is spent — the §11.5 path every other metered
  action already uses.
- `ACTION_PROFILES.COMMAND` goes from 500 to **600 output tokens**. A shared cap must be priced
  for the more expensive thing that draws on it, and a scope note is longer than a section command
  (`SECTION_SCOPE.maxTokens` is 600). The unit cost goes ₹1.2789 → ₹1.4094.
- The `COMMAND` cap in `PLAN_LIMITS.STUDENT` and `INSTITUTION_SEAT` goes from **5 to 4**.
  `FREE_TRIAL` stays at 2, which it has room for.
- `OUTLINE` stays in `UNMETERED_ACTIONS`, still once per document, still amortised. FR-3.6 is no
  longer an `OUTLINE`-cap question at all.

STUDENT lands at **₹98.92**, FREE_TRIAL at ₹33.16. Both within the ceiling; the ceiling test in
`packages/config/test/cost-model.spec.ts` is what holds this.

A shared cap rather than a new one because the two actions are the same kind of act — a Strong-tier
rewrite of one piece of the student's own text, on request, applied only when they accept it — and
because the ₹100 ceiling is a real constraint rather than a target. A student who spends all four
on scope notes has chosen that; the meter in `/usage/me` says which.

## Consequences

- A student gets four Strong-tier rewrites a month instead of five, and can spend them on either
  section commands or scope notes.
- Two assertions in `cost-model.spec.ts` were updated with this ADR as their authority: the
  `COMMAND` cap (5 → 4) and its derived unit cost (₹1.2789 → ₹1.4094). §11.2's printed ₹1.2 is the
  500-token figure and is now the older number.
- **For the human:** the ₹100 ceiling has roughly ₹1 of headroom. The next Strong-tier feature will
  not fit either, and the honest options are the ones §11.4 already names — running drafts on the
  Fast tier when `draftModeStrongTier` is off frees ₹19 — or moving the ceiling. `docs/PENDING.md`
  carries it. Note also that every cost here is computed from `DEFAULT_PRICING`, and no real
  provider call has been made yet: `pnpm ai:verify` is what turns this arithmetic into evidence.
