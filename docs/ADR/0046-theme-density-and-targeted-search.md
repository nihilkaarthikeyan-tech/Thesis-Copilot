# ADR-0046 — Theme density and a targeted search per theme

**Status:** accepted · **Date:** 2026-10-03 · **Builds on:** FR-2.5/2.6 (discover, themes),
ADR-0041 (gap-map relevance signal).

## Context

The owner asked for the technical pieces worth taking from Rademics Copilot. The first on that
list: its literature builder fetches real works, writes targeted queries per thematic cluster, and
counts real publication density per theme. Ours formed themes once, after a single pass of four to
six queries, and never asked how much had been published on each theme. A theme with three
candidates looked "thin" whether the field had thirty papers or thirty thousand, and nothing went
back for more.

Two further faults surfaced on the way: ADR-0041 said the gap map was sorted most-open-gap first,
but the API sorted by candidate count; and OpenAlex's plain `search=` matches full text, so a
density counted with it was inflated by papers that mention a word once in their methods (the
first local run read 57,696 papers for "solar drying marine"; title and abstract gives 239).

## Decision

After the themes are formed, for every theme but "Other":

1. **A targeted query, built in code.** The thesis title's first three content words anchor it to
   the field; the theme name's own words narrow it; when the name adds little, the words its
   papers' titles share fill in (`themeQuery`, deterministic). No model call — Rademics used one
   per cluster; ours costs nothing and is reproducible.
2. **Its real density.** One OpenAlex request per theme with `group_by=publication_year` over
   `title_and_abstract.search`, same window and types as discovery. Stored on the run
   (`Document.meta.searchRuns[runId].themeDensity`): the query, the total, the last three complete
   years against the three before, and `rising` / `steady` / `falling` (≥ +25 %, ≤ −20 %), or no
   trend below twenty works.
3. **Thin themes searched again.** Up to four thin themes run their own query; papers new to the
   run and the library that score at least as close to the scope as the weakest one already kept
   join that theme (at most five each). The filter is the run's own embedding threshold, so a
   filled theme is not padded with weaker papers.

The API attaches the density to each theme and sorts the map by `gapScore`, "Other" last. The
Discover panel shows a line per theme — count, ten-year sparkline, trend — and links to the same
OpenAlex filter so the number can be checked rather than trusted.

## Consequences

- Each discover run makes up to eight more OpenAlex requests (one per theme) and up to four more
  searches, all inside the polite pool and its rate limiter; failures cost a theme its density or
  its extra papers, never the run.
- Filling embeds up to 4 × 25 more texts with Voyage: a fraction of a paisa per run, inside the
  site budget check (`assertBudget`) the run already makes. No metered unit changes.
- The classification of ADR-0041 is unchanged; density is shown beside it, not folded into it.
  Whether a large field with few candidates should read "under-read" rather than "open gap" is
  a judgement to make after students have used it.
