# ADR-0058 — Email the student when a long job finishes and nobody is watching

**Date:** 2026-10-04
**Status:** Accepted
**Builds on:** PRD §7.2 (Resend or SMTP, transactional only), §12.2 (no tracking), ADR-0039
(chapter build), ADR-0056 (examiner review), D.1.1 (coherence run), FR-2.5 (literature search).

## What prompted it

`docs/research/coverage-map.md` row 64: Jenni tells a student a long background job is safe to
close and emails them when it is ready. Ours ran the same work in the worker, but the student had
to keep the tab open and watch the clock.

## Decisions

1. **Which jobs.** The four a student starts and waits on for minutes: the literature search
   (`search-literature`, Discover and Expand), the chapter build, the examiner review, and a
   coherence check the student pressed (`triggeredBy: 'MANUAL'`; autosave and feedback runs were
   not asked for and send nothing). Not the short ones: suggestions, `resolve-reference`,
   `index-source`, `find-sources`, drafts, outlines.

2. **When.** One email when the job ends (done or failed), only if all hold:
   - it took at least **60 s** from the press (BullMQ's `job.timestamp`, the enqueue time, to the
     end — what the student actually waited);
   - **nobody is looking**: no poll from a *visible* tab in the last **30 s**;
   - the student has not turned off **"Email me when a long job finishes"** (`User.settings.
     emailWhenJobDone`, on unless `false`);
   - **never twice** for a run: a Redis `SET job-email:<runId> NX` claim, taken only once the rule
     says send, so neither a BullMQ retry nor a second worker replica sends another;
   - the account is not suspended, deleted or pending deletion.
   A search or coherence check that throws is retried by BullMQ; it is reported failed only when
   the retries are exhausted (the `failed` handler, `isRetryExhausted`), so a run that fails once
   and then succeeds sends one "ready" email. The chapter build and examiner review never throw:
   they write FAILED themselves and the email goes from their result.

3. **"Not looking" is a heartbeat in Redis, not on the run record.** The pages that show these
   jobs already poll: Discover's run, the build screen's overview and build, the examiner-review
   state. A poll adds `?watching=1` when `document.visibilityState === 'visible'`, and the API
   stamps `job-watch:<runId>` with the time (TTL 120 s) after its ownership check. The coherence
   tab streams over SSE; an open stream says nothing about whether anyone sees it, so the Flags
   tab adds a ten-second visible-only poll of `GET /coherence/:runId?watching=1` while a check
   runs. A hidden tab keeps polling (so the page is current on return) but does not count.

   The brief suggested putting `lastWatchedAt` on the run record (`Document.meta.searchRuns` and
   friends). That was rejected: the worker rewrites the whole `meta` object from its in-memory
   copy as the run progresses, so a heartbeat written beside it would either be wiped by the
   worker's next write or — worse — a heartbeat's read-modify-write would wipe the worker's
   terminal status and leave a run stuck at RUNNING (the very fault CLAUDE.md's "the worker owns
   terminal job state" records). Redis has no such race and cleans itself up.

4. **The worker sends it.** The worker owns terminal job state, so it is the one place that knows
   the job ended whoever is watching. The mailer moved from `apps/api/src/common/mailer.ts` to a
   new `@tc/mail` package shared by both processes; the API keeps its file as a thin re-export plus
   the Nest token, so every API caller and test is unchanged. The worker reads the same mail
   variables from the same `.env` (production Compose gives both services `env_file: .env`, and
   `packages/config` already refuses to start production without a mail provider); without one it
   is the console mailer, which only logs — what dev and the mock e2e stack get.

5. **The email.** Plain text, no HTML, no images, no tracking pixel or tracked link: the thesis
   title, what finished, one sentence of what it produced (counts the job observed), one link to
   the page (`APP_URL` + path), and one line to turn these off (`APP_URL/app/settings`). A failure
   says it did not finish; it says "Nothing was charged" **only** when the run gave its unit back
   and the refund statement succeeded (the chapter build on REFUSED/FAILED, the examiner review on
   every failure). A failed search or coherence check makes no claim about charges: the search is
   not a metered unit, and a coherence unit is not refunded on failure.

6. **The promise on screen.** While one of these jobs runs and the setting is on, its page says
   "You can close this — we’ll email you when it is ready." With the setting off it keeps the old
   line ("You can leave this page; …").

## Consequences

- A job under a minute sends nothing even if the tab was closed; the result is on the page.
- One Redis key per watched run (two minutes) and one per emailed run (seven days).
- A mail fault is logged and swallowed; it never fails a job.
