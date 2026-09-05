# ADR-0004 — An `AuditEvent` table beyond PRD §8

**Status:** accepted (2026-09-05, Phase 1 week 5). **Supersedes:** nothing.

## Context

PHASES 5.9 asks for a "reset caps" button that is *logged*, and 5.10 for a pilot report that
counts *cap-exceeded events*. PRD §8 has no table for either: `UsageLedger` counts units that
were served, so a refusal leaves no trace; an admin action leaves nothing at all; the feedback
link (5.9) needs somewhere to record that a message was sent.

## Decision

One append-only table, `AuditEvent { kind, userId, actorId?, documentId?, detail?, createdAt }`,
with `kind` as text (`CAP_EXCEEDED`, `CAPS_RESET`, `PLAN_CHANGED`, `FEEDBACK`). A cap refusal is
written by `UsageService.consume` — the one place every metered action passes — so the count in
the report is the count of refusals the student actually saw.

## Alternatives

- Reuse `AiCallLog` with `ok=false, error='CAP_EXCEEDED'`: wrong meaning (no call was made) and
  it would skew the §14 failure-rate alert.
- A Prometheus counter only: not per user, not per period, gone on restart.

## Consequences

`docs/PRD.md` §8 is unchanged; this is an addition, recorded here per §0.3 rule 4. Migration
`0005_audit_event`. Nothing reads the table except the admin routes and `pnpm pilot:report`.
