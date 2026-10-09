# ADR-0136 — The abstract on its own queue, before the full text

**Status:** accepted · **Date:** 2026-10-09 · **Changes:** how ADR-0070's "abstracts are indexed
first" is done. `resolve-reference` now queues `index-abstract`, which queues `index-source`.

## Context

`apps/web/e2e/_measure/first-session.spec.ts` on the real models, 2026-10-09: the first cited
sentence on a "Start writing now" thesis came at 15.6, 18.1, 19.6, 20.3, 22.4 and 38.3 s. In the
slow run, 29 s after Start only one of twenty papers had a passage.

ADR-0070 put the abstract first *inside* `index-source`: embed the abstract, then look for the full
text (arXiv, Unpaywall and up to four PDF copies, CORE, Europe PMC, Springer Nature). The job is
still one job, so the abstract waits for a slot, and the queue has two slots per worker.

### Measured

`apps/worker/scripts/measure-first-passages.ts` reads the eight measured theses of the morning
from the dev database and the job records BullMQ keeps in Redis for a day (seconds from the
thesis's creation; a passage's time is its UUID v7):

| | find-sources done | resolve, each | index job waits for a slot | index job runs | first / third / fifth / tenth passage |
|---|---|---|---|---|---|
| fastest run | 6.6 s | 1–3.5 s, 3 at a time | 0–17 s | 1–16 s | 10.6 / 12.4 / 18.9 / 23.7 s |
| slow run | 8.3 s | 1–3 s | **22–55 s** | 1–18 s | **34.0 / 36.4 / 50.5 / 55.0 s** |

- The abstract step takes 0.4–1.6 s (index start to its first passage). Full-text attempts take
  5–20 s per paper, and fifteen to twenty-five papers arrive within seconds of each other.
- The slow run's first index job was queued at 11.2 s and started at 35.8 s. Its own papers were
  not ahead of it: **the previous thesis's 25 papers were**, still downloading full text 28 s
  after their own search. The queue is first-in first-out across students, so one student's
  downloads hold up the next student's first passage.
- `resolve-reference` asked Unpaywall and OpenAlex (journal citedness) before it queued the paper,
  for fields reading does not use.
- Several outside calls on this path had no time limit: the resolver, Unpaywall and CORE in both
  jobs, journal citedness, and every Voyage embedding request.

## Decision

1. **A queue for the abstract alone, `index-abstract`.** `resolve-reference` queues it. The job
   stores the abstract's passages (one Voyage call, one section "Abstract"), marks the paper
   ABSTRACT, then queues `index-source` for the same content with `abstractStored: true`. Four
   slots: it is one small embedding and a few rows, network-bound.
2. **`index-source` keeps two slots** (it downloads and parses PDFs on a VPS shared with ~20 other
   sites). With `abstractStored` and passages present it skips its own abstract step, and when no
   full text is found it leaves the abstract as it is: no second embedding, no delete-and-insert
   window in which the paper has nothing to cite. Full text, when found, replaces it as before.
   Queued any other way (uploads, "Fetch PDF", a DOI fixed by hand) it does ADR-0070's abstract
   step itself, unchanged.
3. **Job ids key on what the job reads.** Both are `indexJobId(queue, { sourceId, contentKey })`
   (`@tc/types`): the source and its DOI (or upload key). The full-text id is the one it always
   had. `abstractStored` is not in the id: it does not change what is read.
4. **`resolve-reference` queues the paper before the Unpaywall and citedness lookups**, which now
   run in parallel after it and save `oaStatus` and `venueCitedness` in a second write.
5. **Time limits:** the resolution 150 s (above the scholarly client's 120 s ceiling on a polite
   `Retry-After`, so a busy OpenAlex is still waited out rather than marked unresolved),
   Unpaywall / citedness in `resolve-reference` 15 s, Unpaywall / CORE in `index-source` 20 s,
   every Voyage request 60 s (`VOYAGE_TIMEOUT_MS`, in the adapter).
6. **The API counts a paper as being read while either queue holds it** (`QueueService
   .unfinishedIndexing` / `indexingFor`): the editor's progress line and the reader's "still being
   read". A paper moves from one queue to the other inside the first job, so it is never in
   neither while it is being read.

## Not done, and why

- **Batching abstracts across papers into one Voyage call.** Each paper reaches `index-abstract`
  when its own resolution finishes, one to three at a time; batching would mean holding the first
  paper back for the others, the opposite of the aim. Each call is ~80–300 tokens; four in flight
  is far below Voyage's per-minute limits. (`find-sources` already embeds all its candidates in one
  call to choose them.)
- **Writing passages in `find-sources`, before resolution.** It would save the ~2–3 s of
  resolution, but a passage could then be cited from a record with no authors yet, and the
  resolver can still refuse the match.
- **Shorter full-text timeouts, or priorities within one queue.** Neither helps while every slot
  is held by downloads; once the abstract is off that queue, the full text's speed no longer
  decides when a paper is citable.
- **More `index-source` slots.** More concurrent PDF parsing on a shared VPS, for no gain to the
  first passage.

## Consequences

- Expected from the measured timings (to be confirmed by the main session's re-run): each paper's
  first passage about a second after its resolution, so first / tenth passage ≈ 11 / 15 s in the
  slow run (was 34 / 55 s) and ≈ 11 / 15 s in the fast one (was 11 / 24 s). What remains is the
  initial search (6–13 s) and resolution (1–3.5 s each, three at a time).
- One more queue on the admin jobs screen (it lists `QUEUE_NAMES`), one more BullMQ worker
  connection in the worker process.
- Cost unchanged: the abstract is embedded once, as before (ADR-0070 already embedded it first).
- Found while measuring, not fixed here: two `find-sources` runs a few seconds apart (10.3 s and
  13.9 s in one thesis) added the same papers twice. The second copy's
  `resolve-reference` job has the same id as the first's and is dropped, so the copy stays
  PENDING ("Looking it up…") for good. Five such pairs in each of two measured theses.
