# 0115 — "How was this?" after a build

Date: 2026-10-08
Status: accepted (Jenni build plan Round 3, R36; inventory §6)

## Context

Jenni follows a generated document (a literature review, a gap analysis) with a "How was this
document?" thumbs card. Ours had thumbs on a chat answer (kept on the turn) and on a suggestion
(`SuggestionEvent.rating`), but nothing on the largest things the product makes: a chapter build
(ADR-0039, ₹9.04 of a student's month) and a viva question set (ADR-0030). Whether those were any
good was known only from a feedback message, if one came.

## Decision

- **An `OutputRating` table** (migration `0044_output_rating`): the thesis, who, what (`kind`:
  `CHAPTER_BUILD` or `VIVA`), the run (`runId`: the build's id, the question set's `setId`), up or
  down (`1` / `-1`), an optional note, and when. One row per person per run (unique on kind, run,
  person); answering again changes it. The rating belongs to the run, not to its text, so it is
  stored beside the run rather than inside a report: one table serves every kind of generated
  output, and the next one (R37's literature review, R38's gap document) adds a `kind`, not a
  column. It goes with its thesis (foreign key, `ON DELETE CASCADE`), so `DocumentEraser` and
  account erasure remove it with nothing added to them; a copy of a thesis does not copy it.
- **`PUT /documents/:id/ratings/:kind/:runId`** with `{ rating: 1 | -1 | 0, note? }`, kind
  `chapter-build` or `viva`. Owner only (anyone else, or a run that is not this thesis's, gets
  404). A chapter build can be rated once it is `DONE`; a viva set once it exists. `0` takes the
  rating back, note and all — the same press-again-to-undo as the chat and suggestion thumbs. The
  note is one line of at most 200 characters (line breaks become spaces), so it stays a remark.
  Free: no model, no allowance.
- **The build's view and the viva view carry `rating`**, so the card opens as the student left it.
- **`RateThis`** (web) is the card: the question, thumbs up and down, then a one-line box ("What
  worked?" or "What went wrong?") with Send, and a line saying who reads it. On the Build page it
  sits under a finished build's QA summary ("How was this build?"); on the Viva page under the
  question set ("How were these questions?"). Keyed by the run, so another build or a new set
  starts unrated.
- **The superadmin reads them in Admin → Feedback → Ratings**: newest first, useful / not useful
  counts, each with the kind, the student, the thesis title, the note, and a link to the account.
  `GET /admin/feedback/ratings`, SUPERADMIN only. Ratings have no read or answered state: they ask
  for nothing back, as a feedback message does. Like feedback, a rating carries the thesis's title
  and never its text.
- **Deep research answers** already had chat thumbs (kept on the turn); they are unchanged.

No new prompt, no model call, no allowance.

## Not done

- **The examiner review** (ADR-0056) is a list of flags in the Check tab, not a document, and is
  being changed elsewhere at the time of writing; it has no card.
- **Chat and suggestion thumbs are not in the Ratings list.** They are kept where they were (the
  turn, `SuggestionEvent`) and the feedback email already carries the last five suggestion
  ratings; moving them is a separate change.

## Evidence

`apps/api/test/output-rating.spec.ts` (8 tests, real application): a finished build is rated up with a
note, the view returns it, a second answer changes the same row, `0` removes it; a viva set is
rated; a build still running, a run of another thesis, another student and a signed-out caller
are refused; a note over 200 characters is refused and line breaks are folded; the ratings are in
`GET /admin/feedback/ratings` for a superadmin with the counts, and refused to a student; deleting
the thesis removes its ratings. `apps/web/e2e/rate-this.spec.ts` (not yet run): the viva card
end to end (rate, a line, reload, take back), the build card's request for a finished build
(served to the page, since a real build needs the worker), and both at 390 px. Not yet checked
in a browser.
