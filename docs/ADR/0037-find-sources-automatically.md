# ADR-0037: Find sources automatically when the library has none

Date: 2026-09-30 · Status: accepted (the owner approved the writing-quality plan, step 3)

## Context

A reviewer compared a Literature Review written with Jenni against one written here
(`AI_Literature_Review_Comparison_Report.docx`). Jenni cited every sentence; ours cited nothing and
had no technical content. The cause: we may only cite passages from papers in the student's
library (§10.6), and the library had nothing on the section. Jenni searches the literature on its
own. The report also found Jenni's weakness: 3 of its 5 citations could not be confirmed as real
papers. Ours cannot have that fault, because a citation here is always a passage we fetched.

## Decision

When the student writes and nothing in the library is on topic, the system finds papers itself:

- **Trigger.** Autocomplete, when no retrieved passage reaches chat's measured relevance floor
  (`RELEVANCE_FLOOR`, cosine 0.3); a draft, when it is refused for having no passage.
- **Search** (worker job `find-sources`, no LLM call): OpenAlex, plus Semantic Scholar, PubMed and
  arXiv where configured, queried with the chapter title, its scope note and the last sentence
  written.
- **Keep** only papers with an abstract, not already in the library, whose abstract is at or
  above the same relevance floor against the query; the best 5.
- **Add** them to the library marked `Source.autoAddedAt`, carrying the abstract the search already
  read, and send them down the path a student-picked paper takes: `resolve-reference` (the real
  record: title, authors, year, journal, DOI) → `index-source` (full text where it is open
  access, the abstract otherwise).
- **Tell the student** at once: "No source in your library covers this yet. We are finding papers
  on it…". The library shows the papers as "Added automatically"; the student can remove any.
- **Show the record.** Hovering a citation now shows the paper's title, authors, year, journal, a
  DOI link, and whether the citation could draw on the full text or only the abstract.

Found and fixed on the way: a paper picked from the literature search lost its abstract
whenever the resolver had none (Crossref often has none), leaving it unreadable and uncitable.
The pick now carries the abstract and `resolve-reference` keeps it.

## Bounds

- 5 papers per search; 5 searches a month on the free trial, 20 on paid plans
  (`AUTO_SOURCES`), counted from the `SOURCES_FOUND` log; one search per chapter per 10 minutes
  (the BullMQ job id).
- The site-wide budget check runs first, and the embedding spend is logged as `EMBED`, so the
  ₹100 per-student ceiling sees it.
- Measured on the local stack against the real indexes and Voyage (2026-09-30): two searches, 45
  candidates read, 10 papers added and indexed, 14,340 embedding tokens, **₹0.075 in total**.
  Twenty a month is well under ₹1 in practice; the worst case assumed in `plans.ts` (₹0.50 a
  search, ~₹9 a month) leaves a fully active student near ₹35 of the ₹100.

## Switches

- Site: the `autoSources` feature flag, **off by default**; an admin turns it on in
  Admin → Settings → Feature switches.
- Student: "Find sources for me" in Settings, on unless turned off.

## Not done

- A paper about the same subject in another country or material still passes the relevance
  floor (the test search added rooftop-solar studies from Vietnam and South Africa to an Indian
  thesis). The different-material warning (step 4) addresses citations of that kind.
