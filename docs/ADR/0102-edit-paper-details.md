# 0102 — Edit a paper's details

Date: 2026-10-07
Status: accepted (Jenni build plan Round 2, R15; inventory §4, §13.9)

## Context

Jenni lets a student correct a reference's details in a form shaped by its kind. Ours had none:
a misspelt author or a wrong year from an index stayed in every citation; the only remedy was
"fix the reference" by DOI, which re-imports the same index record.

## Decision

- `GET` / `PUT /sources/:id/details` (owner only, free): type, title, authors, year, journal or
  book or conference or website, volume, issue, pages, publisher (or university, institution), DOI,
  link. Written to the stored CSL record — which a citation is built from first (`toCslItem`) — and
  to the row's columns, so every citation of the paper, in every chapter, the bibliography and the
  export, follows on its next render. A corrected paper counts as identified (RESOLVED).
- `@tc/citations` `details.ts`: `detailsOf` reads the form from what a citation prints now;
  `withDetails` writes it back keeping everything else the record carries (an abstract, an ISSN).
  An edited record is marked (`tc-edited`, never sent to citeproc) and its authors are printed as
  typed: the repair that drops an institution listed among people (ADR-0078) is for index data, not
  for a list a person wrote.
- The library row's **Edit details** opens the form under it; the fields follow the kind (journal
  article, book, chapter, conference paper, thesis, report, web page). Authors one per line,
  "Family, Given", an organisation as its name.

## Evidence

`packages/citations/test/details.spec.ts` (3) and `apps/api/test/source-details.spec.ts` (2):
the label goes from "Kumr, 2020" to "Kumar & TERI, 2021"; the rest of the record is kept; a paper
needs a title; another student's paper is not found. Browser, real stack: Gadekar 2026's form read
its four authors, journal, volume, issue, pages and DOI; the year set to 2025 and saved, both of
the chapter's citations of it read "(Gadekar et al., 2025)"; put back to 2026.
