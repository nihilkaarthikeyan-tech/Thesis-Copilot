# 0110 — Review mode: a check's results in the text

Date: 2026-10-08
Status: accepted (Jenni build plan Round 2, R23; inventory §13.3; fix list B)

## Context

Jenni opens a review as tracked changes in the document: the old words struck through and the new
ones beside them, with a bar: Resume editing (Esc), Reject all, Accept all, ↑ 1/3 ↓, Reject (N),
Accept (Y). The bar ends at "All suggestions resolved!" and a "Try next" check. In ours,
proofreading and the tone review listed their corrections in the side panel (Y/N and Accept all
since 2026-10-04), and the coherence flags had Go to. The student read each fix away from the
sentence it was about.

## Decision

- **A `TrackedChanges` extension** (`@tc/ui`, `editor/tracked-changes.ts`) draws a list of changes
  as decorations: struck words, the new words in a widget beside them. A change with no new words
  (a flag) is drawn as a highlight. Like the supervisor highlights (ADR-0017), it writes nothing
  into the chapter. The ranges are mapped through every edit. A change whose words are edited or
  deleted under it, or were never where the check said, is marked `gone`: it is no longer drawn
  and can never be applied to other words.
- **`ReviewMode`** (web) is the bar. A panel hands it its list (`startReview`, `lib/review-mode.ts`)
  with a `decide` callback for its own bookkeeping. Y accepts, N rejects, ↑ ↓ (and J K) move, Esc
  ends the review. Accept all and Reject all are buttons. A click on a change in the text selects
  it. At the end the bar says "All suggestions resolved!", with the same check again and "Try
  next".
- **Flag, don't fix.** Nothing changes until the student presses Accept or Y on a change they can
  see. An accepted change is written exactly as the panel's own Accept writes it: `insertText` on
  the span, `COMMAND` provenance. Accept all is one transaction, so one Undo takes it back.
  Rejecting a correction remembers it, as Dismiss does.
- **The chapter is read-only while the review is open**, as Jenni's "Resume editing" implies: Y and
  N are letters. Esc gives the keyboard back, and whatever is undecided stays in the panel's list,
  with "Review in the text (N)" to return to it.
- **Which checks.** Proofreading and the tone review open the review in the text as soon as a run
  finds something. The Check tab's flags (coherence, citation support, examiner) can be walked
  through with "Review in the text": Y resolves, N ignores without asking for a reason. The flags'
  own list still asks for one. A flag is a highlight, not a change: none of them carries
  replacement words. The examiner's `suggestion` is advice ("the correct statement or the change
  needed"), so it is shown, not applied.
- **Try next:** proofreading → the tone review → the coherence check → proofreading. It opens the
  Check tab and puts the keyboard on that check's button; it does not run it, since each run takes
  a unit from the allowance.
- **On a phone** the check drawer closes when a review starts, so the text is visible, and "Try
  next" opens it again. The bar sits above the tab bar, and the floating Suggest button is hidden
  while the chapter is read-only.

No new prompt, no new allowance: the reviews run on what the checks already return.

## Evidence

`packages/ui/test/tracked-changes.spec.ts` (6): a change is drawn as struck and new words, and a
note as a highlight, with the document unchanged; the range follows an edit before it; a change
edited inside or never found is `gone` and not drawn; remove, active and clear; a click names the
change.

Browser, real stack and models. A test sentence with five mistakes; a real proofread took 6 s and
opened in the text with "1 / 5". Y applied "results" (provenance `COMMAND`), ↓ moved, N left
"recieved" and dismissed it, and Accept all applied the other three. The bar then said "All
suggestions resolved!". One Undo took back Accept all and a second took back the Y. Esc gave the
chapter back with all six of a second run's corrections still listed. In the phone layout the
drawer closed when the review opened, the first change was in view, and "Try next: Tone of voice"
opened the Check tab with the keyboard on the tone review's button. A citation-support flag
walked through in the text resolved on Y with no prompt and no change to the text. The test
sentence, flag and check time were removed or restored afterwards.
