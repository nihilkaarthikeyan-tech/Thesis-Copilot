# ADR-0139 — A paper is added to a thesis once, under a lock

**Status:** accepted · **Date:** 2026-10-09 · **Closes:** ADR-0136's "found while measuring, not
fixed". **Migration:** `0053_stranded_duplicate_sources` (data only).

## Context

Measuring ADR-0136, two `find-sources` runs in one thesis 3.6 s apart (10.3 s and 13.9 s after
creation) added the same five papers twice; the same in a second measured thesis. Each run reads
the library, drops what is already there, and inserts the rest. Both read before either inserted.

The second copy is then stuck for good. Its `resolve-reference` job id is
`jobId('resolve-reference', documentId, jobKeyDigest(rawReference))`, the first copy's id, so
BullMQ drops it as a duplicate (correctly: the hard-won rule is that a job id keys on what the job
reads). Nothing else ever resolves that row, and the library shows it as "Looking it up…".

The same check-then-insert shape is in every path that adds papers: Find papers' select, the
reference list and add-by-DOI (`resolveReferences`), "Search the literature" in an edit
(`edit-literature`), and add-by-id for a record with no DOI (`paper-id`). Any two of them at once
can do the same.

## Decision

1. **`addSourcesOnce(prisma, documentId, items, create)` in `@tc/db`.** One transaction that first
   takes `pg_advisory_xact_lock(hashtextextended('tc:sources:' || documentId, 0))`, then reads the
   library and inserts only the items not already there. A paper is "already there" by DOI (any
   case), the exact reference line, or the normalised title (lower case, letters and digits,
   single spaces: the rule `find-sources` already used). An earlier item of the same call counts.
   Each item comes back with its row and whether this call created it.
2. **Follow-up jobs are queued after the commit, for created rows only.** A job queued inside the
   transaction could run before its row exists; a row this call did not create already has its
   job.
3. **Used by** `find-sources` (worker), Find papers' select, `resolveReferences`, the
   `edit-literature` add and the `paper-id` add without a DOI (API). Uploads, `cite-parse` and
   `extract-paper` are left as they are: an upload has nothing to match on until it is read, and
   the other two create a paper only from text the student just pasted or wrote.
4. **Clearing the copies already made**, by the same rule twice:
   - migration 0053, once, for every thesis;
   - `removeStrandedDuplicateSources(prisma, { documentId })` at the start of each `find-sources`
     run for that thesis (idempotent, one statement, a failure is logged and never stops the
     search), so a copy made by the old code just before the deploy is cleared too.

   A row goes when it is PENDING, more than ten minutes old (a copy whose resolution is merely
   still running stays), and a RESOLVED row in the same thesis has the same DOI, normalised title
   or reference line. **Never** a row that is cited (`Citation`), pinned (`ChapterSourcePin`),
   filed in a collection, highlighted, has passages, or whose id appears in any chapter's
   content: those carry the student's work and stay for the student to merge (ADR-0045).

## Not done, and why

- **A unique index.** The library deliberately holds duplicates until the student merges them
  (library hygiene finds and merges them), resolution fills a DOI in after the insert, and the
  title match is normalised. An index would turn every one of those into a failed write.
  `ON CONFLICT` needs that index.
- **Giving the second copy a job id of its own.** It would resolve, and the library would then
  hold the same paper twice, both read and embedded, each costing an embedding.
- **Matching a copy that is PENDING against another PENDING one.** Neither is known to be the
  good one; the rule only removes a copy whose twin has resolved.

## Consequences

- An add for a thesis waits for any other add for the same thesis: a few inserts, milliseconds.
  Adds for different theses never wait for each other.
- Find papers' select and the paper-id add now also treat a same-title paper as already present
  (they matched by DOI and reference line before). A preprint and its journal version with the
  same title are one library entry, which is what the merge would have made of them anyway.
- `find-sources` reports, logs and resolves only the papers it created; a paper another run added
  meanwhile is logged as skipped.
- Proved against real Postgres (`apps/api/test/source-dedupe-race.spec.ts`): two concurrent
  five-paper adds leave five rows, and ten with the lock removed.
