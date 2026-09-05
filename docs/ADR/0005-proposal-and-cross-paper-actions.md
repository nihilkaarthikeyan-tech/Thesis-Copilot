# ADR-0005 — `PROPOSAL` and `CROSS_PAPER` in `AiAction`

**Status:** accepted (2026-09-05, Phase 2 week 6).

## Context

PRD §8 lists fourteen `AiAction` values. Two calls Phase 2 makes have none: the Path A proposal
conversation (A.6, FR-1.5) and the cross-paper consistency pass (A.16, FR-1.6). `AiCallLog.action`
is that enum, and §11.5 wants every call logged with real usage. Logging them as `EXTRACT` or
`CHAT` would put Strong-tier once-per-document calls under the wrong name — and `CHAT` is capped,
which would make the proposal conversation spend a student's chat allowance.

## Decision

Add `PROPOSAL` and `CROSS_PAPER` to the enum (migration `0007_ai_action_values`) and to
`AI_ACTIONS` / `UNMETERED_ACTIONS` in `packages/config`. Both are bounded per document in code
(at most four model turns per conversation; one cross-paper pass per set of seed papers), the way
§11.4 amortises `EXTRACT`, not by a monthly cap.

## Consequences

The E.2 completeness test still holds (every action is metered or explicitly unmetered). §11.2
has no unit-cost row for either; the human should add one from the first real calls
(`docs/PENDING.md`, cost model).
