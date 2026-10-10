# ADR-0149: Paper index budgets, refusals and a search that says when it is degraded

**Date:** 2026-10-10 · **Status:** built, unreleased · **Asked by:** the owner (side-by-side
findings 1 and 2, `docs/research/SIDE-BY-SIDE-2026-10-10.md`)

## Context

Measured on production on 2026-10-10: every keyed OpenAlex request answered HTTP 429 with

```
{"error":"Rate limit exceeded","message":"Insufficient budget… you only have $0 remaining. Resets at midnight UTC", …}
x-ratelimit-remaining-usd: 0     retry-after: <seconds to midnight UTC>
```

once the key's free $1 a day was spent (a `search` request is $0.001, a list/filter request
$0.0001, a single-record lookup by DOI or id is free). The same request **without** the key
answered 200 from the polite pool, which is site-wide and only $0.10 a day. Semantic Scholar runs
without a key and answers 429 with no `Retry-After` when busy.

Nothing in the product said so. `web-scope.service.ts` turned any failed index into `[]` with a
log line, so a dead OpenAlex read as "no papers on this"; the automatic library (`find-sources`)
kept adding what the other indexes returned, which for an engineering thesis is mostly off topic.

## Decision

1. **Keyless retry, remembered** (`packages/retrieval/src/scholarly/http.ts`, `health.ts`). A 429
   whose body or headers say the budget is spent is retried **once, at once, without the key**,
   and the fact is stored (`scholarlyHealth`, Redis key `scholarly:health:<index>`, shared by the
   API and the worker) until `retry-after` or, failing that, midnight UTC. Until then every request
   goes keyless without asking again. A 429 that is not a spent budget (or a keyless one) marks the
   index **refusing** until its `Retry-After`, or for `REFUSAL_BACKOFF_MS` (60 s) when it sends
   none (Semantic Scholar); no request is sent before that time, so nothing hammers an index that
   said no. One log line per state change, not per call.
2. **A day meter** (`meter.ts`): every answered OpenAlex request is counted per UTC day in Redis
   (`scholarly:openalex:day:<date>`), classified by URL as search / list / lookup, and priced.
3. **Admin alerts** (`AlertsService.scholarlyBreaches`, the existing §14 mailer to
   `SEED_ADMIN_EMAIL` + `ALERT_EMAILS`): `OPENALEX_BUDGET_70`, `OPENALEX_BUDGET_90` (only the higher
   is open at a time; the day turning clears it), `OPENALEX_KEY_SPENT` and `INDEX_REFUSING`. Each
   emails once per incident, like every other alert. A Redis fault is logged, not alerted.
4. **A typed search status everywhere** (`apps/api/src/modules/assist/search-status.ts`). Each
   index's outcome is `ok`, or `refused` / `timeout` / `failed` with the time it said it would be
   back. `degraded` means OpenAlex (the index that covers every field) did not answer. The one
   line the student sees is built in code: "OpenAlex is not answering right now; results come from
   Semantic Scholar and PubMed only — try again later." It reaches:
   - the web scope and the Papers panel (`/chat/web` returns `status` and `notice`);
   - search beyond the library and the research chat (a `notice` step, kept on the turn under the
     answer; an empty search says the index did not answer instead of "no papers");
   - "On" searching on a library question and every part of deep research (a `notice` step);
   - edit actions that find literature (`EditLiterature.searchStatus`, the notice leads the note).
5. **`find-sources` does not fill the library from a degraded search** (`DEGRADED_SOURCES`):
   when OpenAlex answered nothing and failed at least once, the bar is `addCosine + 0.05`, at most
   2 papers are added (not 5 or 15), the `SOURCES_FOUND` row carries `degraded: true`, and the run
   is tried again once OpenAlex should be back (from the remembered state; 30 min when nothing
   said; clamped to 5 min – 12 h), at most twice. The retry's BullMQ id is keyed on what it reads,
   `find-sources-retry-<chapterId>-<query digest>-<attempt>`, with no `:`.
6. **Cheap calls where a search is not needed.** Already the case and now metered: DOI resolution
   is `/works/doi:…` (free); journal citedness reads venues by `openalex_id:` filter (list price,
   50 per request); `resolve-reference` uses an OpenAlex `search=` only when Crossref did not
   settle a reference with no DOI.

## Searches per action (counted from the request paths)

| Action | OpenAlex search-priced requests | Cost of the $1/day key budget |
|---|---|---|
| Thesis created (`find-sources`, initial) | 3: one semantic, keyword for the title, keyword for the section (asserted in `find-sources-degraded.spec.ts`) | $0.003 |
| …then each added paper resolved | 0 when it has a DOI (free lookup); 1 only for a DOI-less reference Crossref cannot settle | ≤ $0.001 each |
| Chat beyond the library (one question) | 1 keyword search (plus Semantic Scholar, PubMed, arXiv) | $0.001 |
| Chat "On" research (library question) | 1 semantic + 1–2 keyword | $0.002–0.003 |
| Deep research run (3–5 parts) | 2 per part: 6–10 | $0.006–0.010 |
| Edit action that finds literature | 1 semantic + its keyword plan (1–2) | $0.002–0.003 |

So the free key carries about 330 new theses, or 1,000 beyond-library questions, or 100–160 deep
research runs a day; the keyless pool ($0.10, shared site-wide) about a tenth of that. These are
counts of what the code sends, not a live measurement against production; the day meter now
records the real figure, and the 70% alert says when it matters.

## Consequences

- A spent key no longer empties every search: the polite pool answers until it too is spent, and
  the student is told when results are thinner than usual.
- Trade-off: a degraded `SOURCES_FOUND` still counts against the month's automatic searches, so a
  bad OpenAlex day can use one or two of them; the retry is bounded to two.
- The day meter is our count, not OpenAlex's bill (a refused request is not counted).
- Owner actions are in `docs/PENDING.md`: a prepaid top-up only if the 70/90% alerts fire, free
  Semantic Scholar, CORE and NCBI keys, and a separate OpenAlex key for development.
