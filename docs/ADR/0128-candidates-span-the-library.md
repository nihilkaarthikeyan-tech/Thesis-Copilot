# 0128 — Candidates span the library, and the vector query never walks the global index

Date: 2026-10-08
Status: accepted (the owner's manager, 2026-10-08, after the demo video: "while writing it has to
refer more number of indexed papers")
Follows: ADR-0078 (per-paper cap for drafts), ADR-0087 (wider paper pool, citations spread).
Changes: PRD §10.4's candidate step ("ORDER BY embedding <=> :query LIMIT 24").

## Context

ADR-0087 answered the same complaint ("revolves around three papers") on 2026-10-07: fifteen
starting papers, two passages per paper in a suggestion, cited papers stepping back. It worked
on what reached the rerank, but the rerank only ever saw §10.4's **24 nearest chunks**. A
full-text paper is dozens of chunks, so the 24 came from a handful of papers, and the rules after
it could only share passages among those. Measured on the dev database with
`apps/worker/scripts/measure-paper-spread.ts` (the real `retrievePassages`, sentences from each
thesis's own chapters): 24 candidates from 6 of 14 papers; a section draft was sent passages from
**4.2 papers** on average, a suggestion from 3.6, in libraries of 14–15.

The same measurement found a worse fault. For the largest library (56 papers, 3,850 chunks) the
query returned **no candidates at all**. `EXPLAIN ANALYZE` showed why: the planner walked the HNSW
index, which yields the ~40 nearest chunks of the **whole table** (`hnsw.ef_search`), and only
then applied `documentId = :doc`; all 51 rows it saw belonged to other theses. Which plan the
planner picks depends on table statistics, so as the product grows more libraries would get fewer
or no passages, silently. Production holds 624 chunks today and is not yet affected.

## Decision

1. **Each paper offers its best three chunks first** (`CANDIDATE_PER_SOURCE = 3`), in a window of
   **48** (`CANDIDATE_LIMIT`, was 24) — up to sixteen papers reach the rerank. Slots no other paper
   can fill go back to the nearest of the rest, so a library of one paper still fills the window.
   Done in SQL (`ROW_NUMBER() OVER (PARTITION BY sourceId ...)`) for the writing paths
   (`retrievePassages`: suggestions, section drafts, chapter builds, chat).
2. **A section draft takes at most two passages from one paper** (`PER_SOURCE_CAP.DRAFT`, was 4),
   so its twelve passages come from six papers when there are six. Suggestions stay at 2 of 6.
3. **Every vector query ranks one thesis's chunks exactly** and never walks the global HNSW index:
   the per-paper form is fenced by its window function, the plain form (coherence's per-citation
   lookup) and `findChapterNeighbours` by `OFFSET 0`. One library is a few thousand chunks; the
   exact ranking of the 56-paper library takes ~0.1 s. The HNSW index stays; nothing uses it now,
   and a query across theses (none exists) would be the only reason to.

No prompt changes, and no cost change: the model is sent the same number of passages
(6 / 12 / 8), from more papers.

## Evidence

`measure-paper-spread.ts`, same theses and sentences, before → after:

| | before | after |
|---|---|---|
| candidates per request | 24 (0 for the 56-paper library) | 48 |
| papers in a section draft's passages | 4.19 | 7.94 |
| papers in a suggestion's passages | 3.56 | 3.81 |

Tests: `rank.spec.ts` (window and caps), `pgvector.spec.ts` (the SQL), and
`apps/api/test/retrieval.spec.ts` against real pgvector — a paper with ten near chunks and three
further papers: nearest-first gives six chunks of one paper, `perSource: 3` gives three of it and
one of each other; one paper alone still fills six.

**On the real models (2026-10-09),** `apps/web/e2e/_measure/draft-paper-spread.spec.ts`: a new
thesis titled "Barriers to rooftop solar adoption among rural households in Karnataka" had 15
papers ready 30 s after creation; one section draft ("Financial and institutional barriers to
adoption", ~500 words) made 9 citations to **6 different papers**.
