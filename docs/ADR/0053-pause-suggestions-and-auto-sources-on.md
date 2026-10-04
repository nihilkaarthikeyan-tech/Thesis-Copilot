# ADR-0053 — Suggestions on a pause, and automatic sources, on by default

**Status:** accepted · **Date:** 2026-10-04 · **Changes:** ADR-0006 (automatic-suggest off by
default), ADR-0037 (automatic sources behind a flag, off).

## Context

Jenni suggests when the student pauses; ours only on Ctrl+/ unless the student found a setting.
Automatic sources (ADR-0037) — finding papers when the library has nothing on what is being
written — existed but was held off by its flag. The owner decided (2026-10-04): turn both on.

## Decision

- `GET /settings` returns the student's own `automaticSuggest` choice when they have made one;
  otherwise the `automaticSuggest` feature flag (seeded in FR-9.7, never read until now). The flag
  is on in production; seeded off, so tests and new environments are unchanged.
- The `autoSources` flag is on in production.

## Consequences

- Suggestions now appear after an 800 ms pause and each one counts against the monthly Assist
  allowance whether kept or not, as Ctrl+/ suggestions always have. At 180 a month on paid plans
  (50 on the trial) a student who writes daily will reach the cap in days. The allowance is the
  owner's open decision (`docs/PENDING.md`); counting only kept suggestions, as Jenni does, would
  be a cost-model change.
- Automatic sources spend embeddings and OpenAlex requests on a student's behalf, inside the site
  budget check, with no metered unit (ADR-0037).
