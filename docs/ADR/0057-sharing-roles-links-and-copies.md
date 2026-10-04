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
