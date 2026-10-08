# 0112 — Bibliography notes: a year chart and the venue spread

Date: 2026-10-08
Status: accepted (Jenni build plan Round 2, R25; inventory §13.3)

## Context

Jenni's Source Quality review ends with two notes on the document's bibliography: a
publication-year chart ("median year 2021; 1 of 3 works over a decade old") and a venue spread
("3 unique venues across 3 works"). Ours had the standing problems (ADR-0076: retracted, preprint,
uncited, rarely cited journal) for the whole library, and nothing on the age or the spread of what
a chapter actually cites. A supervisor asks both: "is this literature current?" and "is it all
from one journal?"

## Decision

- **The notes are over the open chapter's citations**, each paper once however often it is cited,
  read from the `Citation` rows every save keeps. "Check my sources" saves the chapter first, so
  the notes match what is on screen. A Jenni document is one of our chapters.
- **`GET /documents/:id/sources/quality?chapterId=`** adds `notes` to the existing answer (null
  without a chapter, so nothing else that calls it changes). Free, no model: the figures are
  `bibliographyNotes` (`apps/api/src/modules/sources/bibliography-notes.ts`), pure.
  - **Years:** how many have one on record, the median (of an even count the earlier middle year,
    a year really there), oldest and newest, how many are over a decade old (published eleven or
    more years before this UTC year), and bins for the chart: one a year over a short span,
    otherwise round 2-, 5-, 10-, 20-, 50- or 100-year bins, never more than 12, clipped to the
    years present, empty bins kept so a gap shows.
  - **Venues:** how many have one on record, how many distinct (the same OpenAlex journal id, or
    the same name once case, spacing and a trailing full stop are set aside), the five most used,
    and the papers in the rest.
- **Only what the record holds.** A paper with no year is not charted and a paper with no venue is
  not counted as a venue; the words say how many there were, never a guess.
- **Drawn with plain HTML bars**, no chart library. The year chart is as wide as the panel at most
  (the panel is 288 px) and 40 px a bar at most, so three bars do not stretch across it. Bars wholly
  over a decade old are grey, the rest the accent colour; the first and last year are labelled
  under it and each bar names its span and count on hover. Venues are a list with a bar each; a
  long journal name is cut with an ellipsis and kept whole in its tooltip.
- **In the panel:** "The N works this chapter cites", the two notes, then "The papers in your
  library" with ADR-0076's list as before.

No new prompt, no new allowance: the notes are counts over records we already hold.

## Evidence

`apps/api/test/bibliography-notes.spec.ts` (14): median and the decade line, the even-count median,
ten years is not over a decade and eleven is, a missing year left out, one bar a year, round bins
within the limit and clipped, a century within the limit, venues counted and ranked, spelling and
the OpenAlex id, a missing venue, the top five and the rest, an empty chapter.
`apps/api/test/bibliography-notes-api.spec.ts` (4): the notes cover the named chapter's papers once
each and no other chapter's; an empty chapter; no notes without a chapter; another thesis's
chapter is a 404 and a malformed id a 400. `apps/web/test/bibliography-notes.spec.ts` (6): the
sentences, including the missing-record ones. `apps/web/e2e/source-quality-notes.spec.ts` (written,
run by the main session): four cited papers, one twice and one with no year or venue, at 1440,
1280, 1024, 768 and 390 px, with the layout measured.
