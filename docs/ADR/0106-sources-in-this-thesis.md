# 0106 — Sources in this thesis

Date: 2026-10-07
Status: accepted (Jenni build plan Round 2, R19; inventory §13.9)

## Context

At the end of a Jenni document, "Sources (N)" opens every cited paper with badges, Open PDF, and
"Library Source" or Save, with **Save to library** for all. Ours listed the open chapter's
citations and the bibliography; there was no view of the thesis's sources as a whole. In ours a
citation can only point at a library paper, so Jenni's "Save" has one meaning here: a paper that was
**found for** the student (ADR-0037) becoming one they **added** — which "Cite from my library"
(R3) and the library-search setting (ADR-0087) count.

## Decision

- `GET /documents/:id/cited-sources` (free): every paper the chapters cite, from the citation rows
  kept on each save — how often, in which chapters (in order), what we hold of it, and whether it was
  found for the student; most cited first.
- `POST /documents/:id/cited-sources/keep` (free): the cited papers that were found become the
  student's own — all of them, or the ones named. A found paper that is not cited is left as it is.
- **Sources in this thesis (N)** at the top of the editor's Citations tab opens the list: each paper
  with its label, venue, Full text / Abstract only, Open access, "Cited N times — chapters", Read,
  and **Keep in my library** (or "In your library"); **Keep all in my library** for the found ones.

## Evidence

`apps/api/test/cited-sources.spec.ts` (2). Browser, real stack: "Sources in this thesis (4)"; the
four cited papers, Gadekar 2026 cited twice, all four found; Keep on Lundgren 2013 → "1 paper is
now in your own library", the banner went to 3 (set back afterwards).
