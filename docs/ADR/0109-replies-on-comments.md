# 0109 — Replies on comments

Date: 2026-10-08
Status: accepted (Jenni build plan Round 2, R22; inventory §13.3, §13.10)

## Context

Jenni's comments take replies, reactions, edits and deletes. A supervisor's comment in ours could
be accepted, revised, resolved with a reason or left open, but not answered: a student who wanted
to say "the sample is in 3.2" had to resolve the comment or say it somewhere else, and the guide
could not answer back.

## Decision

- **A thread under every comment.** A new `CommentReply` table (migration `0042_comment_replies`:
  comment, author's email, body, thumbs, created, edited) and `Comment.thumbs`. The student and
  any guide who may comment (the same `access` check as the comment itself, so a Reader cannot)
  can reply, `POST …/comments/:id/replies`.
- **Each person changes only their own reply.** `PATCH` and `DELETE …/replies/:replyId` refuse
  anyone but the author with 403. An edited reply says "edited". A reply holds up to 4,000
  characters, the same as a comment.
- **Thumbs-up, given or taken back,** on the comment and on each reply (`POST …/thumb`), stored as
  the emails that gave one. Jenni offers a row of emoji; a thumbs-up is the one reaction a guide
  and a student need, and the product already uses the icon for "useful" in chat and the
  suggestion bar.
- **One component, three screens.** `CommentThread` sits under the comment in the review panel
  beside the chapter, in the review queue and on the guide's page. Every action answers with the
  comment as it now stands, which the screen swaps into its list. Each reply carries `mine`, so
  the screen needs no session lookup to know which replies it may edit.
- **Resolving is unchanged.** Accept, "I have handled this", or a reason in the queue still close a
  comment. A thread is the conversation before that, not a new way to close one; the response-to-
  committee table is untouched.
- **Free.** No model and no allowance.

## Not done

No email when someone replies. Comments themselves do not email today (the guide sees them on the
page, the student in the queue), so replies follow the same rule. If the owner wants reply
notifications, they belong with a notification for new comments, through `@tc/mail`.

## Evidence

`apps/api/test/comment-replies.spec.ts` (3 tests, real application, a student and a guide each
signed in, the share accepted through `/guide/accept`): both answer each other in order; editing
sets `editedAt`; the student is refused 403 on the guide's reply, both for edit and delete; the
guide deletes their own; a thumbs-up toggles on and off; the guide's thumb lands on the student's
reply; the student resolves the thread.

Browser, real stack: on the student's chapter a guide's comment showed "Reply". The student
replied, gave a thumbs-up (pressed, 1), edited the reply ("edited"), thumbed the guide's answer,
and saw no Edit or Delete on it. A reload kept all of it. In the review queue the same thread
showed and the student deleted their own reply, and typing "j" in the reply box did not move the
queue. Signed in as the guide on `/guide/:token`, the guide saw their reply as "You", the
student's thumb on the comment, and replied; the student's list then had the guide's two replies,
`mine: false`. The test comment, share and guide account were removed afterwards.
