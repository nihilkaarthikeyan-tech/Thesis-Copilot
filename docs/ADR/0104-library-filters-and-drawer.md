# 0104 — Library filters, the details drawer, Cite from the library

Date: 2026-10-07
Status: accepted (Jenni build plan Round 2, R17; inventory §4)

## Context

Jenni's library filters by year, open access and type, opens a paper in a details panel that
steps through the list with ↑ ↓ and has Ask AI, and cites in one click. Ours filtered by full text
and collection only; a paper opened the reader page; citing it meant going to the reader.

## Decision

- **Filters** (`lib/library-filters.ts`, pure): publication year from/to (a year box keeps what is
  typed and filters once it is a whole year), access (open / not open — an unknown status is in
  neither), kind (journal article, book, chapter, conference paper, preprint, other — from the CSL
  type, which the library rows now carry, and the preprint flag). They narrow the list on top of the
  full-text and collection filters; **Clear** says how many are shown.
- **Details drawer** (`LibraryDrawer.tsx`), from **Details** on each row: the record, the abstract
  (`GET /sources/:id` now carries it), ↑ ↓ (keys and buttons) through the papers the list shows,
  Esc to close, and:
  - **Cite in my chapter** — the reader's own hand-off (ADR-0068): the chapter opens and asks where;
  - **Ask AI** — the chapter's chat answering from this paper only, with three questions about it
    (summary, method and sample, limitations; fixed wording, no model) — the hand-off now carries
    questions without a picture too (R13);
  - **Read**, **Edit details** (R15).

## Evidence

`apps/web/test/library-filters.spec.ts` (4). Browser, real stack, 14 papers: year from 2025 → 7;
with open access → 7; Preprints → 3; Clear → 14 (the year typed digit by digit — the first version
reset the box at "2" and a year could never be typed); the drawer stepped 1 → 2 → 3 of 14 by key and
button (a key handler that assumed an element target was fixed); Ask AI opened the chat on
"Gadekar 2026" with its three questions; Cite opened the chapter with "Citing Raja 2026. Click in
your chapter where it goes".
