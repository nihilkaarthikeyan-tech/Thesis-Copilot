# ADR-0134 — Full text from the Springer Nature Open Access API

**Status:** accepted · **Date:** 2026-10-09 · **Changes:** FR-2.2's full-text chain (arXiv →
Unpaywall → CORE → Europe PMC, ADR-0054) gains a fifth step, for Springer Nature papers only.
Follows up ADR-0054's "Consequences".

## Context

Springer, Nature, BMC and SpringerOpen answer a server's PDF download with a JavaScript bot check,
which we must not get past (ADR-0054). Europe PMC covers the papers deposited in PMC. Everything
else Springer Nature publishes open access stayed ABSTRACT: *Discover Food* (the Jenni comparison
of 2026-10-04), the SpringerOpen journals, EPJ, and hybrid articles in subscription journals. The
publisher's own Open Access API serves the same articles as JATS, with permission, for a free key.
The owner registered it on 2026-10-09 (`SPRINGER_NATURE_API_KEY`).

## What the API does (read live, 2026-10-09, §0.3 rule 1)

- `GET https://api.springernature.com/openaccess/jats?q=doi:<doi>&api_key=…` → 200
  `application/xml`: `<response>…<records><article>` with the full JATS article. Seen for BMC Public
  Health, Discover Food, Nature Communications, Annals of Operations Research (hybrid), EPJ C and
  Journal of Big Data. Recorded as fixtures, key removed:
  `packages/retrieval/test/fixtures/scholarly/springer-*`.
- A closed article (in the same hybrid journal), a closed book chapter and a DOI that does not
  exist all answer 404 `"No data was found for the given query."`. The API does not say which of
  these it is.
- A missing or wrong key gives 401. A non-DOI query (journal, year) gives 403 "premium feature"
  on the free plan.
- No rate-limit headers, only `dois-downloaded: 1`. Springer Nature's developer documentation
  gives the Basic plan 100 requests a minute and **500 a day** on the Open Access API. It answers
  429 past either.
- The JATS has no page breaks. Text is split by section only; chunks have no page.

## Decision

- **`SpringerNatureClient`** (`packages/retrieval/src/scholarly/springer.ts`): one request per
  DOI. It needs an article whose `<article-id pub-id-type="doi">` matches exactly, a
  `<license license-type="open-access">` and a `<body>`. The text comes from the same
  `jatsToText` as Europe PMC: one span per top-level section, tables kept row by row, figure
  captions kept, references, acknowledgements and back matter dropped.
- **Typed failures, never thrown:** `no-record`, `not-open-access`, `no-body`, `rate-limited`,
  `daily-limit`, `unauthorized`, `timeout`, `error`. One retry on a network fault or a 5xx. A
  401/403 or a 429 is not retried. After a 429 the client stops asking for `Retry-After`, or for
  15 minutes when the response gives none. The key only ever goes into the URL. Nothing returned
  or logged contains it, and a test checks this.
- **Rate:** one request a second in-process. A **Redis day count**
  (`scholarly:springer:day:<UTC date>`, `dailyAllowance`) stops at 480, which leaves a margin
  under the 500 because Springer's day may not start at UTC midnight. A worker restart does not
  reset the count. Nothing is cached, so a re-index asks again, as with Europe PMC.
- **Which papers use a request:** a DOI with one of Crossref member 297's prefixes (Springer
  Nature, read from `api.crossref.org/members/297`: 10.1007, 10.1186, 10.1038, 10.1140, 10.1057,
  10.1023 and the rest). Research Square's 10.21203 is left out because it is not in the API.
  A paper whose stored Crossref record names Springer as `publisher`, or member `297`, also
  qualifies.
- **Where in the chain:** in `index-source`, after every PDF has failed and after Europe PMC.
  Europe PMC needs no key and has no daily cap, so it goes first. The result is FULL_TEXT,
  `from: 'open-access-xml'`, `via: 'springer'`. No file is stored, because nothing was downloaded.
  "Fetch PDF" (ADR-0101) re-runs the same job, so it uses the step as well.
- **Optional key:** `SPRINGER_NATURE_API_KEY` is optional in the Zod schema. Without it there is
  no client and the step is skipped without a log line.
- Two parser fixes to the shared `jatsToText`, found on Springer's JATS:
  - Springer puts a table inside a body `<p>` and each cell's text in its own `<p>`. That ended the
    paragraph at the first cell, so the cells came out one per line with no separators. The `<p>`
    tags are now removed inside table rows. List items are handled the same way.
  - Springer gives each formula as MathML and also as a whole LaTeX document
    (`\documentclass[12pt]{minimal}…`). Next to MathML the LaTeX is now dropped.

## Consequences

- Live run (`apps/worker/scripts/springer-fulltext-proof.ts`, 2026-10-09):
  - Discover Food: 38,974 characters in 6 sections (37 chunks). Table 1 kept its header row.
  - Nature Communications: 58,467 characters in 5 sections (49 chunks).
  - EPJ C: 43,693 characters in 7 sections (40 chunks).
  - Journal of Big Data: 134,478 characters in 8 sections (102 chunks).
  - A closed Annals of Operations Research article: `no-record`.
  - About 1.2 s a paper.
- 500 requests a day is shared by every student. A busy day can use it up. After that, papers
  stay ABSTRACT with the reason in the log, and a later re-index or "Fetch PDF" reads them. If
  that happens often, the Premium plan (10,000 a day) is the owner's decision.
- A source grounded this way has no "Open PDF" link, as with Europe PMC.
- Production needs `SPRINGER_NATURE_API_KEY` in the VPS `.env` and a restart of the worker (the
  only process that uses it).
