# ADR-0022 — a journal figure: OpenAlex's 2-year mean citedness

**Date:** 2026-09-24
**Status:** Accepted
**Extends:** FR-4.9's chat filters (year, citation count, preprints) and the library screen.
Adds two columns to `Source` beyond PRD §8.

## What prompted it

A competitor's chat filters by "impact factor". We had no journal-level signal at all — only a
paper's own citation count, which says nothing about where it was published.

## The decision

- **The figure is OpenAlex's `summary_stats.2yr_mean_citedness`**: citations last year to what the
  journal published in the two years before, per paper. OpenAlex's own documentation calls it
  "also known as impact factor", and it is the same idea — computed on OpenAlex's open data, not
  Clarivate's. **It is never called "Impact Factor" in the product**, which is Clarivate's name for
  Clarivate's number; the library says "journal citedness", and the tooltip and the filter say
  exactly what it is and whose it is.
- **Journals only.** OpenAlex computes the same figure for repositories and conference series —
  arXiv's is 0.17 — and a preprint server's average says nothing about a journal. Anything whose
  OpenAlex source is not of type `journal` has no figure.
- **Unknown is not zero.** `venueCitedness` is null when OpenAlex has no journal or no figure. The
  filter leaves such a source out ("at least 3" cannot be said of something unmeasured), and the
  filter's own help text says so.
- **Stored on `Source`** (`venueOpenalexId`, `venueCitedness`) when a reference resolves: the
  resolver already asks OpenAlex for the work, which names its journal; one more request gets the
  journal's figure, cached for a day per journal in the worker, so a library of forty papers from
  six journals costs six. `pnpm backfill:journals` fills in sources resolved before this existed.

## Rejected

- **Clarivate's Journal Impact Factor, or Scimago's SJR.** Licensed data; neither can be
  redistributed in a product like this.
- **Computing a figure ourselves** from citation counts. It would be a number no one else
  publishes, presented beside names students recognise.
- **Scoring Discover's candidates too.** Sixty candidates a run is up to sixty journals; it can
  come later if students ask for it, and costs OpenAlex requests every run until then.

## Consequences

- Migration `0017_source_venue_citedness`. A failed lookup never fails a resolution; the figure is
  simply unknown.
- The figure is last year's. It moves once a year, and a source keeps the figure it was stored
  with until the backfill is run again against sources whose journal is cleared.
- The chat refusal for "your filters removed everything" now names the journal filter too.
