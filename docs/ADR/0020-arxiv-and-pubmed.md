# ADR-0020 — arXiv and PubMed as search indexes

**Date:** 2026-09-24
**Status:** Accepted
**Extends:** FR-2.5 (literature discovery), FR-2.1 (reference resolution) and ADR-0016 (chat's
"Find papers" scope). PRD §7.2 names the scholarly APIs; these are two more of the same kind.

## What prompted it

A competitor searches arXiv and PubMed; we searched OpenAlex (and Semantic Scholar when keyed).
OpenAlex indexes both eventually, but "eventually" is the point: an e-print is on arXiv the day it
is announced and reaches OpenAlex days or weeks later, and a biomedical student expects PubMed's
MeSH-mapped search, not a general one.

## The decision

- **Both indexes are searched by Discover and by chat's Find papers**, alongside OpenAlex. Ten
  results per query each (OpenAlex gives 25): every candidate is an embedding in the run.
  Results merge by DOI as before, OpenAlex's record first, so a paper found twice keeps its
  citation count and open-access status.
- **They are sent content words, not questions** (`keywordsOf`). arXiv treats every word as a
  term and PubMed ANDs them, so "what does the literature say about…" floods or empties both.
- **One Redis slot per service, shared by the API and the worker** (`sharedGate`). arXiv's terms
  allow one request every three seconds "across all of the machines under your control"; NCBI
  allows three a second per address (ten with the optional `NCBI_API_KEY`). A limiter in each
  process would send twice the rate between them. The worker waits as long as it needs; the API
  waits at most a few seconds, because a student is watching.
- **arXiv e-prints are never downloaded.** arXiv's API terms forbid storing and serving e-prints
  from our servers unless their licence allows it, and `GET /sources/:id/file` serves stored
  files. An arXiv-only source is grounded on its abstract (metadata is CC0), and the student can
  upload the PDF, which is their own use. Results link to the abstract page, as arXiv asks.
- **The resolver falls back to arXiv for an arXiv DOI** (`10.48550/arxiv.*`). Crossref never has
  one, and OpenAlex's coverage is patchy: on the day this was built it had `2410.08098` and not
  `1706.03762` ("Attention Is All You Need", which it holds under another DOI). A withdrawn
  e-print still resolves — the student asked for it — and is marked the way a retraction is.
- **Retractions and notices are not offered.** PubMed's publication types say so outright:
  `Retracted Publication`, `Retraction of Publication`, `Expression of Concern` and `Published
  Erratum` are all left out. A notice quotes its paper's title, so it ranks beside it — a live
  search offered one. Withdrawn arXiv e-prints are left out the same way.
- **XML is read by targeted extraction** (`scholarly/xml.ts`), as the `.docx` comment import
  already does — two known, machine-generated formats, a handful of fields. No new dependency.

## Found while checking it live

- **OpenAlex refuses `?` and `*`** ("Wildcards require exact search", HTTP 400). Chat's Find
  papers sent the student's question as typed, so every question ending in a question mark got
  nothing from OpenAlex — and before this change OpenAlex was its only index. Every OpenAlex
  search now strips both (`openAlexSearchText`).
- **OpenAlex ranks question words too.** Sent "What does the literature say about rooftop solar
  adoption barriers?", its first result was "What Will 5G Be?". ADR-0016 had chosen to send the
  question as typed on the belief that OpenAlex handles natural language; every index now gets
  the content words.
- **Author names from OpenAlex were stored as literals**, so a citation printed "Zeyad Awwad
  (2023)" where APA wants "Awwad, Z. (2023)". OpenAlex and arXiv names are now split into family
  and given names (`personName`), particles kept with the family name ("de Weck").

## Consequences

- About 15,000 more embedding tokens per Discover run (34 more candidates in the live check):
  ₹0.03 at §11.1's price. Nothing else is metered.
- Discover's embedding step already exceeds the Voyage account's unpaid limit (10K tokens a
  minute); that is the open `docs/PENDING.md` item, and it predates this change.
- `NCBI_API_KEY` is optional; without it PubMed still works at three requests a second.
- Unpaywall can name an arXiv copy as a journal article's best open-access location, which the
  existing full-text path downloads and stores for that student. That is personal research use,
  which arXiv's terms allow, but it is listed in `docs/PENDING.md` for the owner to confirm.
