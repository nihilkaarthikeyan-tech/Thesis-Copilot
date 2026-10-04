# ADR-0057 — Sharing: roles, a read-only link, and making a copy

**Date:** 2026-10-04
**Status:** Accepted
**Builds on:** PRD §5.7 and Appendix D.2.1 (guide shares), §12.1 (scoping and rate limits),
ADR-0028 (the co-author `canEdit` share), ADR-0035 (an admin may read a thesis, openly).

## What prompted it

`docs/research/coverage-map.md` rows 78–81: Jenni offers Editor / Commenter / Viewer roles by
email, "anyone with the link" access with a chosen role, live cursors and document cloning. We
had guide/committee shares (comment and suggested revisions), co-author shares (`canEdit`) and
live cursors, but no plain reader, no way to change what someone may do short of revoking and
re-inviting them, no link, and no copy.

## 1. Roles

- **Three roles, two booleans.** Guide / committee (reads, comments, suggests), Co-author (also
  edits live, ADR-0028) and Reader (reads). Stored as `GuideShare.canEdit` (existing) and a new
  `GuideShare.canComment` (default true, so every existing share stays what it was). Not an
  enum: the live editor, the chapter build and the document detail already ask `canEdit`, and a
  second column that had to agree with it would be a second source of truth.
  `apps/api/src/modules/feedback/share-roles.ts` names the combinations; a co-author always
  comments too.
- **A Reader gets the thesis text and nothing else.** `CommentsService.access` refuses a share
  without `canComment` on every comment route — writing, listing and counting — with a 403. A
  Reader does not see the guide's comments either: what the student shares "to read" is the
  thesis, not the conversation about it.
- **The owner changes a role in place** (`PUT /documents/:id/feedback/shares/:shareId`
  `{ role }`). Every permission check reads the row on each request and nothing is cached, so a
  change or a revoke takes effect on that person's next request. Only the owner can do either:
  the route is scoped by `ownerId` and answers 404 to anyone else.
- `POST …/shares` takes `role`; `canEdit: true` from an older tab still means Co-author.
- The invitation e-mail names the role. Co-author is offered in the dialog only while the
  `collaboration` flag is on, as before.

## 2. "Anyone with the link can read"

- **Off by default; read-only, always.** The owner turns it on from the Share dialog
  (`POST /documents/:id/feedback/link`), turns it off (`DELETE`), or makes a new one (`POST`
  again). There is no role choice on a link: Jenni lets a link carry Editor, and we do not — an
  unauthenticated write path into a thesis is exactly the "writable way into a student's work"
  this product refuses, and a link cannot be attributed, revoked per person, or bound to the
  provenance record. Commenting by link is refused for the same reason (no one to attribute a
  comment to).
- **The token.** 32 random bytes from `crypto.randomBytes`, base64url (43 characters, 256 bits).
  Only `sha256(token)` is stored (`ShareLink.tokenHash`, unique), so a copy of the database is not
  a copy of the links. Lookup is by the hash's unique index, and the stored digest is then
  compared with `timingSafeEqual`, so no path compares secret material with an early-exit
  equality. A string that is not 43 base64url characters is a 404 before it costs a query. Guide
  share tokens are stored in the clear because they are invitations, useless without signing in
  as the invited address (D.2.1); a link token *is* the permission, so it is treated as a
  credential.
- **Turning it off invalidates it.** Off deletes the row; a new link deletes and recreates it in
  one transaction. The old token then hashes to nothing, on the very next request. One link per
  document (`documentId` unique). The cost of storing only a hash: the owner sees the URL once,
  when it is made, and the dialog says so ("Lost it? Make a new one — the old one stops working").
- **What a link holder gets.** `GET /read/:token` (title and chapter list) and
  `GET /read/:token/chapters/:chapterId` (one chapter), with no session guard and no other verbs.
  The chapter is flattened on the server to headings and paragraphs (`read-view.ts`): no
  provenance marks, comment anchors, citation keys, figure keys or footnotes leave the server,
  and pending draft blocks are left out because they are not yet thesis text. No student e-mail,
  no comments, no sources or PDFs, no figures, no AI. Less than a Reader share gets — a Reader is
  a named, signed-in person; a link can reach anyone.
- **Rate limit.** `/api/v1/read/*` is a heavy route kind `link`, 30 a minute per identity (per IP
  for someone signed out) on top of the general 600, Redis-backed like the rest.
- **Audit.** `AuditEvent` `SHARE_LINK_ON` (with `replaced`) and `SHARE_LINK_OFF` for every change;
  each opening increments `ShareLink.views` and `lastViewedAt` (shown to the owner) and is logged,
  as a guide's visit moves `lastViewedAt` and is logged.
- The page (`/read/:token`) is `noindex`, sends `Referrer-Policy: no-referrer` so the token does
  not leak onward, and `/read/` is in `robots.txt`'s disallow list. The privacy page says links
  exist and what they show.
- `DocumentEraser` deletes the link with the thesis (the foreign key also cascades).
