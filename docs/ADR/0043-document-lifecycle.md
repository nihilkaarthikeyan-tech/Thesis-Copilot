# ADR-0043 — An explicit thesis lifecycle state machine

**Status:** accepted · **Date:** 2026-10-03 · **Builds on:** the guide/committee cycle (shares,
comments, the review queue), the submission bundle and its compliance gate (Appendix D.3.3).

## Context

A thesis moves through stages — drafting, out with the guide, revising against comments, ready, and
submitted — but the product never named that state. It was inferred, differently in each place,
from whether a `GuideShare` existed, whether comments were open, and whether compliance passed. A
supervisor could not tell at a glance where a thesis stood, and nothing stopped a student calling a
thesis "submitted" while half its compliance checks failed.

The owner asked to build the integrity-safe technical improvements one at a time; this is the
fourth: one explicit, validated state, with transitions that mean the same thing everywhere.

## Decision

A small state machine with five states — `DRAFTING`, `IN_REVIEW`, `REVISING`, `READY`,
`SUBMITTED` — and six events between them. The machine is **pure** and lives in
`packages/types/src/lifecycle.ts`: a transition table plus guards that read a `LifecycleContext`
(has a share, has comments, has open comments, compliance passes) the caller computes. It persists
nothing and calls no service, so it is settled by a table and its tests
(`packages/types/test/lifecycle.spec.ts`).

- **Storage:** a `DocumentLifecycle` enum and `Document.lifecycle` (default `DRAFTING`) plus
  `submittedAt`, migration `0027_document_lifecycle`. Every existing thesis starts `DRAFTING`;
  nothing depends on the state until the student moves it, so the column is a safe additive change.
- **API:** `GET /documents/:id/lifecycle` returns the state and the actions available from it (each
  marked allowed, or blocked with a reason); `POST` fires one, validated by the pure machine. No
  metered unit — the only work is reads and the same compliance check the Submit screen runs.
- **Web:** a `LifecycleBar` on the Submit screen shows the stage and the moves; a blocked move stays
  visible with its reason, so the student sees what to do next.

The guards reuse real signals rather than inventing new ones: `markReady` requires the **same**
compliance pass `exportThesis` enforces and no open guide comments; `sendForReview` requires a
share; going back to drafting and reopening a submission are always allowed, because a student must
never be locked out of their own writing.

## Why this is safe

- Additive and defaulted: existing theses and the submission flow are unchanged until a student
  chooses to move the state.
- The compliance gate is not duplicated — the machine reads the existing check's result, so "ready"
  cannot drift from what the Submit screen and the PDF export already mean by it.
- No AI, no cost, no new judgement about a student's work: it records where they say the thesis is,
  within transitions that keep the record honest.

## Alternatives considered

- **Keep inferring the state.** Rejected: the inference lived in several places and could not be
  shown or enforced.
- **A workflow engine / library.** Rejected as over-engineering for five states; a table and guards
  are boring and testable (§0.3 rule 5).
