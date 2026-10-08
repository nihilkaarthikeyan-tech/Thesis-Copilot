# 0126 — A check on one paragraph, from the block handle

Date: 2026-10-08
Status: accepted (Jenni build plan Round 2, R26; inventory §10, §13.3)
Follows: ADR-0094 (the block handle), ADR-0067 (the examiner on a selection), ADR-0026
(proofreading), ADR-0084 (the tone review), ADR-0110 (review mode).

## Context

Jenni's block menu runs its checks on the paragraph it was opened on. Ours had one check there:
Review ▸ As an examiner (ADR-0067's selection review), beside Find a source. Proofreading and the
tone review read whole chapters only, 2,000 words a run, so a student who had just rewritten one
paragraph spent a run on the chapter to have it read.

Found on the way: the selection review was started by the editor screen, not by the Check tab's
examiner box. A Check tab that was already open never knew a review had started: it showed no
"Reviewing…", did not reload its flags when the job finished, and (since ADR-0111) never opened
the points in the text.

## Decision

- **The block menu.** "Review ▸" is now **Check this paragraph ▸**: Spelling and grammar, Tone of
  voice, As an examiner, and Find a source for it, with one line saying the three checks take one
  command each and finding a source is free. These are the checks that read sentence by sentence
  and already had (or now have) a range path. The coherence checks read across chapters, and
  "Too close to a source" is a free chapter-wide check with no range; neither is in the group.
- **The API.** `POST /proofread` and `POST /tone-review` take an optional
  `range: { from, to }`, positions in the saved chapter (the block's start and end). The run is
  the same run: the server reads the **saved** chapter, keeps only the sentences that overlap the
  range (the examiner's rule, ADR-0067), and leaves out pending drafts and sentences with no
  letters as before. `fromSentence`, `totalWords` and `nextSentence` count inside the range. A
  range with no sentence of the student's own is refused (400) before any unit. The tone review's
  sample is checked first, as before, so no profile and no paper is still refused for nothing.
- **Metering is unchanged.** Each run is one `COMMAND` unit, taken by `UsageService.consume` (the
  atomic check-and-increment) before the first provider call and refunded if nothing was served;
  the examiner on a paragraph is one `COMMAND`, not an `EXAMINER_REVIEW` (ADR-0067). No new
  allowance, no new prompt, no prompt edit.
- **Who runs it.** The menu hands a request to the Check tab (`apps/web/src/lib/block-check.ts`)
  and opens it. The panel that owns the check runs it, so its results land in its own list and
  open in the text through review mode exactly as a chapter's do:
  - `ProofreadPanel`, in either mode, saves first, takes the block's range from the chapter as it
    was saved, and runs. The review bar says "Spelling and grammar · this paragraph"; at the end
    "Proofread it again" reads the paragraph again, not the chapter. The paragraph's start is
    mapped through every edit, so "Read the next part" and the rerun read the same block. The
    summary says "No mistakes found in this paragraph (54 words)", so an empty answer is not read
    as the chapter's. The tone review uses the sample chosen in the panel (the student's profile
    unless they picked a paper).
  - `ExaminerReview` starts the range review itself, saving first. It now polls a review started
    from the text, says "Reading the selected text only", and when it finishes the Flags tab
    opens its points in the text (ADR-0111). Only the latest run's flags have trusted positions,
    so only the paragraph's points open. The selection toolbar's "Examiner review" takes the same
    path, and the result line says "in the selected text". The whole-chapter button saves first
    too, which it did not before.
- **Once per press.** Every request carries a nonce that is taken once (`takeBlockCheck`). Each
  check spends a unit, so a panel that mounts again later, or React running an effect twice in
  development, must not run it a second time.
- **The menu stays inside the window.** It is measured once drawn (before paint), again when a
  submenu opens and when the window changes size, and placed beside the grip, moved up or left to
  stay 8 px inside the window; it is never taller or wider than the window less 16 px, and
  scrolls beyond that. Before, its position used a fixed 380 px estimate, so with "Turn into"
  open near the bottom of a short window it ran off the screen.

Flag, don't fix: a paragraph's corrections, rewrites and points change nothing until the student
presses Y or Accept on one they can see, as in ADR-0110.

## Cost

Nothing new. A paragraph is a fraction of the 2,000 words a proofreading or tone run is sized
for (ADR-0026, ADR-0084), and the examiner on a paragraph is the one call ADR-0067 priced. The
`COMMAND` allowance bounds all three, and it is unchanged, so the fully active student's monthly
cost does not move.

## Not done

- The menu's words are English, as the rest of the block menu (ADR-0094).
- No browser proof in this ADR: it was written in an isolated worktree without a browser. The
  main session's check is recorded in docs/BUILD_LOG.md (R26).

## Evidence

- `apps/api/test/proofread.spec.ts`: a range reads only its paragraph (the other paragraph's
  misspelling is not read), one `COMMAND` unit and one call; a range over a pending draft or past
  the chapter's end, and one that ends before it starts, are refused with no unit and no call.
- `apps/api/test/tone-review-api.spec.ts`: a range reads only its paragraph's sentence, one unit;
  a range with nothing in it is refused with no unit.
- `packages/ui/test/block-handle.spec.ts`: `blockRange` is the block's start and end, from
  anywhere inside it, lists too.
- `apps/web/test/block-check.spec.ts` (a request is taken once, by its own panel);
  `apps/web/test/place-menu.spec.ts` (the menu inside 1440, 1280, 1024, 768 and 390 px windows,
  three heights, from a grip anywhere, closed and with the longest submenu open);
  `apps/web/test/examiner-review.spec.ts` ("in the selected text").
- `apps/web/e2e/block-checks.spec.ts` (written, run by the main session): spelling and grammar on
  one paragraph opens its one correction in the text and Y applies it, the other paragraph
  untouched, one unit; the tone review refused for nothing without a profile; the examiner on a
  paragraph is one `COMMAND`, not an `EXAMINER_REVIEW`; the menu inside the window at the five
  widths with each submenu open.
