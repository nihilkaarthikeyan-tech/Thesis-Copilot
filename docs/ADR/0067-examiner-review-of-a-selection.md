# 0067 — An examiner review of just a selection

Date: 2026-10-05
Status: accepted
Follows: ADR-0059 (row 53) and ADR-0056 (the chapter review it reuses).

## Context

Jenni's Review reads whatever the writer selects. Our examiner review (ADR-0056) reads a whole
chapter for one `EXAMINER_REVIEW` unit (6 a month) — too heavy for "is this paragraph right?".

## Decision

- **No new prompt and no new job.** `POST /chapters/:id/examiner-review` takes an optional
  `{ from, to }` (positions in the saved chapter); the same `examiner-review` job runs with a
  `range` and keeps only the sentences inside it, in their sections.
- **One COMMAND unit**, not an `EXAMINER_REVIEW` unit: at most 50 sentences, which is one examiner
  call (~₹0.23), the size the chapter review already sends per section. A failure refunds the
  COMMAND unit; the worker's refund now takes the action it gives back.
- **Only the open examiner flags inside the range are replaced**; flags elsewhere in the chapter
  stay. The run is recorded with `selection: true`, so a later whole-chapter review of the same
  version is not refused as "unchanged since its last review".
- The editor saves first (the job reads the saved chapter), then opens the Flags tab, where the
  findings arrive as flags on their sentences — the same Go to / Resolve / Ignore / keys as ever.

## Tests

API (testcontainers): a selection takes a COMMAND unit, not an EXAMINER_REVIEW one, and its range
is on the job (job id keyed on the range); a selection holding no sentence is refused for nothing.
Worker: only the range's section is sent; only flags inside the range are deleted; a failed
selection refunds COMMAND. Playwright: the button, the notice, the Flags tab, a finished run.
