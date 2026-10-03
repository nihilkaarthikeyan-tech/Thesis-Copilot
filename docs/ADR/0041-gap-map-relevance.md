# ADR-0041 — A grounded relevance signal on the literature gap map

**Status:** accepted · **Date:** 2026-10-03 · **Builds on:** FR-2.5/2.6 (literature search and the
living gap map), ADR-0040 (journal matching, the same "grounded, un-metered scorer in
`@tc/retrieval`" shape).

## Context

The gap map already groups a discover run's candidates into themes (the A.8 Fast call) and flags a
theme `thin` when it has fewer than four papers, recomputed against the library as the student
curates. A competitor (Rademics Copilot) does more with the same raw data: it reads a
"publication-density" per cluster to say where the field is open. Our map had the numbers to do the
same — every candidate already carries a cosine similarity to the scope (the discover run's own
filter) and an OpenAlex citation count — but showed only a count and a boolean.

The owner asked to build the integrity-safe technical improvements one at a time. This is the
second. A flat count cannot distinguish "relevant and thinly covered" (the gap worth pursuing) from
"thinly covered because it barely relates" (a dead end), and both showed identically as `thin`.

## Decision

Add a **per-theme gap signal**, computed in pure code from numbers the search already measured:

- **relevance** — the mean of the theme's candidates' cosine similarities to the thesis scope.
- **coverage** — the theme's volume (papers found, or kept once curating starts) and its median
  citation count, each ranked within the run.
- **gapClass** — `open` (relevant, thinly covered), `active` (relevant, well covered), `crowded`
  (much work, loosely related), `peripheral` (little and loosely related), or `sparse` (too few
  papers to read a relevance from). Sorted most-open-gap first by `gapScore = relevance × (1 −
  coverage)`.

It lives in `packages/retrieval/src/gap/relevance.ts` as a pure function `gapSignals(themes)`, with
thresholds exported as the `GAP_SIGNAL` constant and tests in
`packages/retrieval/test/gap-relevance.spec.ts`. The API's `SearchService.get` computes it from the
candidate rows it already loads and adds a `signal` to each theme in the run view; the Discover
panel renders a label and a one-line reading. Relevance and coverage are ranked **within the run**,
not against an absolute cosine, so "high" and "low" mean "my most/least relevant theme" — a value
that does not drift when the embedding model changes.

## Why this is integrity-safe

- **Nothing is invented.** Relevance is the mean of similarities a model actually produced for real
  papers; coverage is counted papers and their real OpenAlex citation counts. No new model call.
- **It is a reading, not a claim.** The labels say "looks like an open gap", the UI shows the raw
  numbers (median citations, counts) beside them, and `sparse` explicitly refuses to read a
  relevance from too few papers. It guides the student's judgement; it never asserts a fact about
  the field.
- **No metering.** Like journal matching, the signal is arithmetic over data already fetched, so
  there is no provider cost and no `UsageLedger` unit. The only AI in the gap map remains the one
  Fast themes call the discover run already pays for.

## Alternatives considered

- **Deterministic re-clustering of candidates by embedding similarity**, replacing the A.8 themes.
  Rejected for now: it duplicates a feature that already works, and clustering at read time needs
  the candidate vectors (not stored) or a fresh embedding call (a cost). The A.8 themes stay; this
  signal reinforces them.
- **An absolute relevance scale.** Rejected: cosine magnitudes vary by embedding model (we moved to
  `voyage-4` in ADR-0032), so an absolute "relevance 0.4" is not interpretable. Ranking within the
  run is.
