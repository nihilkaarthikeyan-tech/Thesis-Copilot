# 0076 — Source standing in retrieval, a Source quality check, and drafts that search first

Date: 2026-10-05
Status: accepted
Follows: the side-by-side study (`docs/research/side-by-side-2026-10-05.md`), items C1 and C3.
Amends: PRD §10.4's rerank formula (one bounded term added); ADR-0037.

## Context

- **Weak evidence.** For a Karnataka rooftop-solar thesis, both Jenni and we ranked first a
  month-old paper with no citations, by a school student, in a journal with a citedness of 0.2.
  Our autocomplete leaned on it as its main evidence.
- **Retracted papers.** Retrieval never looked at a source's standing: even a retracted paper
  could be offered as evidence.
- **No standing check.** Jenni's review panel has a "Source quality" check (retractions, preprints,
  quality); ours had no equivalent.
- **Thin drafts.** A draft for a section with one or two on-topic papers is thin, while Jenni's
  research chat searches before it writes.

## Decision

1. **Retracted papers are never retrieved** (`findCandidates`: `isRetracted = false`).
2. **Standing as a bounded tie-breaker** (`credibility`, `@tc/retrieval`):
   - **down:** −0.05 for a preprint; −0.03 for a paper with no citations two or more years after
     publication (new work is not punished for being new); −0.03 for a journal with citedness
     below 0.5;
   - **up:** +0.03 for 20+ citations; +0.02 for a journal with citedness 2 or more;
   - **bounds:** −0.08 to +0.05, smaller than the 0.15 sub-theme boost and far smaller than the gap
     between an on-topic and an off-topic passage.
   - It reorders passages that are about equally relevant; it never brings in one that is not.
   - The automatic search (ADR-0037) orders the papers it may add the same way, after the
     relevance filter.
3. **"Source quality" in the Check panel** (`GET /documents/:id/sources/quality`, free, no model).
   - It lists the library's papers that are retracted, preprints, uncited after two years, or in a
     rarely cited journal.
   - Order: retractions first, then by how often the thesis cites them. Each issue gets one plain
     sentence of advice.
   - Facts from the record we hold, never a verdict on a paper's worth.
4. **Drafts search first when a section is thin.**
   - Trigger: fewer than three distinct on-topic sources (cosine ≥ 0.3, the measured relevance
     floor).
   - Draft starts the ADR-0037 search (same flag, student setting and monthly cap), says
     "finding more papers first", and waits up to 35 s for what the search adds to be citable.
   - Abstract-first indexing (ADR-0070) makes that a few seconds. Then it retrieves again and
     writes. When no search may start, it writes from what it has, as before.

## Cost

- No new model call. The search is the existing metered automatic search: it counts against the
  month's automatic searches, and its embeddings are logged as `EMBED`.
- A draft that searches first takes longer (up to ~35 s more), within the job.
- `docs/COSTING.md` is unchanged.

## Tests

- **retrieval:** `credibility.spec.ts` (7: bounds, new work not punished, never outweighs
  relevance).
- **worker:** search-first (searches, waits, retrieves again, writes; skips when enough; writes
  anyway when no search may start); `waitForNewSources` (done when searched and all citable; gives
  up at the limit).
- **api:** `source-quality.spec.ts` (5).
