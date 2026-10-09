# ADR-0142 — Comments and replies send an email

**Status:** accepted · **Date:** 2026-10-09 · **Decided by:** the owner (comments should email),
details delegated to the agent. **Builds on:** ADR-0058 (long-job email, `@tc/mail`), ADR-0057
(share roles), ADR-0109 (replies), ADR-0061 (Hindi interface). **Migration:**
`0054_comment_emails`.

## Context

A guide's comment reached the student only when the student next opened the review queue, and a
student's reply reached the guide only when the guide next opened the share. On a thesis where the
two meet once a fortnight, a question asked on Monday sat unseen for days.

## Decisions

1. **Who.** A new comment or reply emails everyone else who can see the thesis's comments: the
   owner, every share that may comment (guide) or edit (co-author). Never its author; never a
   Reader (`canComment: false` and `canEdit: false`); never a suspended account, one pending
   deletion or one deleted. Only people with an **account**: a guide invited but never signed up
   cannot have seen a comment, and with no account there is no switch to turn the mail off (the
   invitation itself already went to them). A share is matched to its account the way
   `SharesService.assertShared` matches it — the bound user, or the invited address.
   Access is checked again when the email is about to go, so a share turned into a Reader, or an
   account suspended, after the comment was written gets nothing.

2. **What counts.** A comment created through the comment box (`CommentsService.create`) and a
   reply (`CommentsService.reply`). Not a `.docx` comment import (the student is importing their
   guide's comments for themselves), not an edited reply, not a thumbs-up, not a resolution.

3. **At most one email per thread per person an hour; the rest folded in.** Two steps on one
   BullMQ queue, `comment-email`, run by the worker:
   - `event` — queued by the API with job id `comment-event__<rowId>` (the comment or reply), so a
     retried request queues it once. The worker lists the recipients and queues a `send` for each.
   - `send` — job id `comment-email__<threadId>__<userId>__<slot>`, where the slot is the moment the
     hour opens: that person's last email about the thread plus an hour (0 if never). It **keys on
     what it will read** (CLAUDE.md): the events after the cursor that last email left. Every event
     inside one hour computes the same id, so BullMQ keeps one delayed job and the email folds them
     ("And 2 more replies since."). The first email waits a **grace minute**, so a reply typed
     straight after the comment lands in it. A finished `send` is removed at once
     (`removeOnComplete: true`), so its id is free for the next event; an event whose job was
     dropped because the same id was running is picked up by the send itself, which re-queues the
     next slot when anything by someone else is still past the cursor.
   - The throttle is a row, `CommentEmailState (commentId, userId, lastSentAt, cursorAt)`. The send
     claims its slot with **one conditional `updateMany`** — last email an hour old *and* the cursor
     unchanged — so a retry or two workers send once. A mail fault puts the claim back and throws,
     so BullMQ's retry finds the same events. Erased with the comment, the thesis or the user.
   - A person met for the first time on a thread gets a cursor just before the event that brought
     them in, so an old thread's first email starts at the new reply, not at the beginning.

4. **The email.** Plain text, no HTML, no tracking. Subject: "Dr. Menon commented on "Title"" (or
   "replied to a comment on"). Body: who, the thesis title, the first ~200 characters of the
   earliest new comment or reply (whitespace collapsed, cut at a word) — **never the quoted
   passage or any thesis text** — the count of further replies, one link to the comment, and the
   way out. The commenter is named by their account name, else their address (both already shown
   beside the comment in the product).
   - The link: the owner's review queue (`/app/d/:id/review?comment=<id>`, which selects and
     scrolls to it), or the share's page (`/guide/:token?comment=<id>&chapter=<id>`, which opens
     that chapter and scrolls to it). The share token goes only to that share's own account, which
     it was sent to already; it is an invitation, not a key (sign-in with that address is needed).
   - **English or Hindi** by the recipient's `User.settings.interfaceLanguage` (ADR-0061). The
     Hindi wording is the agent's and joins the native-speaker review already pending for ADR-0061.

5. **The off switch.** "Email me about comments and replies" under **Account**, on by default,
   stored as `User.settings.emailOnComments` (JSON, like ADR-0058's `emailWhenJobDone`; read and
   saved through `/settings`). Checked when the email is about to go. While it is off, events are
   still accounted for (the cursor moves), so turning it back on does not deliver a backlog.

6. **One-click unsubscribe, no sign-in.** Each email ends with `/unsubscribe?token=<userId>.<hmac>`
   — HMAC-SHA256 of the user id and purpose under `AUTH_SECRET` (`@tc/mail`
   `unsubscribeToken`/`verifyUnsubscribeToken`, constant-time compare). The page posts it to
   `POST /email/unsubscribe` (no session), which flips the same switch off and offers **Undo**
   (`on: true`). It is a page that posts rather than a GET that changes state, because mail
   scanners fetch every link in a message. The token does not expire (a dead unsubscribe link is
   how a sender gets marked as spam); rotating `AUTH_SECRET` invalidates every link sent. A wrong
   token is a 400 that says nothing about which accounts exist.

## Not done

- No `List-Unsubscribe` / `List-Unsubscribe-Post` headers (RFC 8058): `Mail` carries no headers
  today, and Gmail's one-click POST arrives form-encoded, which the API does not parse. Worth
  adding if comment mail volume ever approaches the bulk-sender thresholds.
- No digest across threads: three new comments are three emails (each thread throttled on its own).

## Consequences

- Production needs nothing new: the worker already has the mail provider and `AUTH_SECRET` from
  `.env`; migration 0054 runs with the release. A worker that has not been redeployed leaves
  `comment-email` jobs waiting (nothing is lost; they run when it is).
- Per comment: one Redis job per other participant, one small row per thread and person.
