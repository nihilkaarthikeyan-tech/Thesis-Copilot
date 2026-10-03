# ADR-0050 — Using OpenAlex properly

**Status:** accepted · **Date:** 2026-10-04 · **Builds on:** FR-2.2, FR-2.5, ADR-0020 (arXiv and
PubMed), ADR-0037 (automatic sources).

## Context

The owner asked whether we use OpenAlex well, having heard it is very good. Jenni's paper search
is built on the same index, so how well we use it is a direct measure against Jenni. An audit
against OpenAlex's 2026 documentation and live calls (2026-10-04) found:

1. **Discovery dropped most of engineering and computer science.** Our type filter allowed
   article, preprint and book-chapter only. Conference papers (ResNet is `conference-paper`),
   reviews, dissertations and books never appeared. For "rooftop solar adoption barriers" since
   2011 that excluded about 1,800 of 10,000 works, including all 193 reviews.
2. **Keyword search only.** OpenAlex has semantic search (`search.semantic`: the text matched by
   meaning against embedded titles and abstracts, 50 results, $0.001, the same as `search=`). On
   "barriers to rooftop solar PV adoption among Indian households" it returned Kerala and Lahore
   household-adoption studies at the top; our keyword search returned South African pilots.
3. **Retractions ignored.** OpenAlex carries Retraction Watch's list (`is_retracted`); every
   OpenAlex record was stored as not retracted.
4. **One open copy tried.** Unpaywall lists every open copy of a paper; we tried only the "best",
   which is often a repository record page with no PDF, so the paper stayed abstract-only while
   the author's or publisher's PDF was free.
5. **A search could stall for minutes or hours.** `Retry-After` was honoured with no ceiling (a
   spent OpenAlex budget answers 429 with the seconds to midnight UTC), no index had a time
   budget, and arXiv's site-wide one-request-per-three-seconds slot held whole runs on
   "Searching…" in production on 2026-10-01.

## Decision

- **Work types**: article, review, conference-paper, preprint, book-chapter, book, dissertation —
  in discovery, the proposal's related-work check, and `cited_by`. Reports and standards stay out.
- **Semantic search**: one `search.semantic` call per discover run (with the whole scope) and
  per automatic-sources search, filtered to the window, those types, `has_abstract:true`,
  `is_retracted:false`. Its results go first so OpenAlex's record wins the merge. The keyword
  queries stay.
- **Retractions**: `is_retracted:false` on every discovery filter; `is_retracted` recorded on
  every OpenAlex-resolved source and OR-ed with Crossref's notice.
- **Full text**: every Unpaywall copy with a PDF is tried, best first, at most four.
- **Time limits**: `Retry-After` over two minutes fails the request instead of being waited
  (OpenAlex's 60-second busy pause is still waited out); every index call has a 25-second limit
  and each index 75 seconds per run (`searchWithinBudget`); the worker's arXiv slot waits at most
  15 seconds and tries twice.

## Not done (listed in the audit, worth doing next)

- Backward snowballing (`referenced_works`) and recent citing works in Expand; ranking Expand by
  field-normalised impact (`fwci`) rather than raw citations.
- OpenAlex topics instead of the deprecated concepts in journal matching, and topic ids for the
  gap-map density.
- Reading OpenAlex's usage headers (`X-RateLimit-Remaining-USD`) into the §14 alerts.
- OpenAlex's own content API (PDF and GROBID XML, $0.01 each): a cost and licensing decision.
- An `OPENALEX_API_KEY` in the local `.env` (production has one).
