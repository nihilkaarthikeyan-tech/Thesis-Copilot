# 0107 — An uploaded PDF names itself from its first page

Date: 2026-10-07
Status: accepted (Jenni build plan Round 2, R20; inventory §13.9)

## Context

Uploading the synthetic test PDF to Jenni lost the author's initial, kept line-break hyphens and
dropped the abstract. Ours, checked the same way, did worse: an uploaded PDF kept its **file name**
as its title, had no authors, year or abstract, and stayed `PENDING` for ever — so the library said
"still looking up", Edit details (R15) was hidden for it and Fetch PDF (R14) skipped it. Nothing
resolved an upload: it has no reference text to resolve.

## Decision

- `readFirstPage` (`@tc/retrieval`): from the first page's text, a printed DOI; the abstract (after
  an "Abstract"/"Summary" heading to the next heading — Keywords, Introduction, "1."); the byline
  (names before the first affiliation word, superscript marks removed, initials kept, each through
  the existing `personName`); the title (the lines just above the byline, joined, stopping at a
  journal-header or affiliation line); a year. Words broken at a line end are joined; real hyphens
  stay. A part it cannot see plainly is left out — never guessed.
- `index-source`, for an upload nobody has identified (PENDING, no reference text, no DOI, no
  authors), right after reading its PDF:
  - a printed DOI → `resolveByDoi` (Crossref, then OpenAlex) → the record, RESOLVED; the page's
    abstract kept when the record has none;
  - else a title from the page → title, byline, year, abstract on the CSL record, RESOLVED;
  - else UNRESOLVED ("needs a hand", where the DOI fix and Edit details are).
- Uploads made before this stay as they were until re-indexed (`docs/PENDING.md`, the existing
  re-read item, now also naming them).

## Evidence

`packages/retrieval/test/first-page.spec.ts` (4: the test PDF; a journal page with a printed DOI and
superscript-marked authors; broken words joined, real hyphens kept; nothing invented) and three
worker tests (first page, DOI preferred, unreadable → UNRESOLVED). Real stack: the test PDF uploaded
→ RESOLVED, "Night-time heat exposure of street vendors in Chennai: a field note", author
{family "Author", given "A. Test"}, 2026, the abstract, full text read. Removed afterwards.
