# ADR-0028 — Real-time co-authoring, behind a flag

**Date:** 2026-09-24
**Status:** Accepted
**Departs from:** PRD Appendix B.1, "Collaboration: none (no Yjs) in Phases 1–3. Guides comment;
they do not co-edit." The same line asked that editor state be kept in the document or plugin
state "so Yjs could be added later". This is that later.

## What prompted it

The last item on the competitor gap list (2026-09-24): two people in one chapter at the same
time, seeing each other's cursors and words. The PRD deferred it for good reasons — a thesis has
one author, the guide cycle deliberately gives supervisors comment-only access — and those
reasons still shape what is built: co-authoring is off by default, opt-in per share, and gives
the invited person the text and nothing else.

## The decision

- **Yjs, with our own small server.** The chapter's ProseMirror document is mirrored into a
  `Y.Doc` (`y-prosemirror`) for as long as anyone has it open live. TipTap's `Collaboration` and
  `CollaborationCursor` extensions run on the client; the server speaks the `y-protocols`
  sync/awareness protocol over a WebSocket (`ws`), which is what `y-websocket`'s provider
  expects. No Hocuspocus: the persistence and permission hooks it offers are the whole of what
  we would write anyway, and its current major needs a different WebSocket runtime.
- **The database stays the source of truth.** A room loads the chapter's JSON and its `version`
  when the first person joins, and stores through the same `ChaptersService.save` every autosave
  uses — word counts, citations, snapshots, the style-profile threshold — debounced a second
  after the last change. If another writer has moved the chapter meanwhile (a restore, an
  accepted revision), the store meets the same conflict the autosave would, the room closes with
  code 4409 and every client reloads onto the fresh text: the existing "changed elsewhere"
  banner, not a new mechanism.
- **One process owns every room.** The API runs two replicas with no sticky routing, so the
  WebSocket path is served by a third instance of the same image with `COLLAB_ENABLED=true`
  (`collab` in compose), reached at `/collab/` through both nginx layers. In development the one
  API process serves it. The host nginx vhost change is the owner's (`docs/PENDING.md`).
- **Who may join.** The document's owner, and anyone whose share carries `canEdit` (a checkbox on
  the share dialog, "can edit with me"). The session cookie authenticates the socket, the same
  Better Auth lookup the HTTP guard makes. A co-author gets a trimmed editor on the guide page:
  the text, formatting, tables, undo — no AI actions, no uploads, no exports, no chat. Those are
  metered against the owner's caps or read the owner's library, and neither belongs to a guest.
- **Provenance is untouched.** Each person's own typing is marked HUMAN by their own editor
  before it reaches Yjs; a remote change arrives as a Yjs transaction, which the provenance
  plugin now skips (`isChangeOrigin`), so nothing is re-marked and nothing is lost. The marks
  travel inside the shared document. Per-person attribution is not recorded: the schema has
  `kind` and `actionId`, not an author, and the AI-usage log only needs to know what was human.
- **Feature flag `collaboration`**, off by default, and **live only with someone to write with.**
  A document goes live when the flag is on *and* it has a share with `canEdit`
  (`DocumentDetail.liveEditing`); every other document keeps exactly the editor it had —
  autosave, `baseVersion`, the 409 banner. A thesis with no co-author gains nothing from a socket,
  and the rule keeps the browser tests for the ordinary editor untouched by the flag.

## Consequences

- No metered action: nothing here calls a model.
- `GuideShare.canEdit` (migration 0020). The share e-mail says which kind of invitation it is.
  Writing the browser test also found that a failed invitation e-mail (Hostinger rate-limited a
  burst) became a 500 *after* the share row was written; the answer now carries `mailed: false`
  and the panel shows the link to send by hand.
- Two development-only traps, recorded because each cost a run: React calls a state initialiser
  twice and keeps one, so a provider that connected on creation left a twin socket in the room;
  and an effect that destroys the provider in its cleanup runs twice too, leaving the kept
  provider deaf to local changes. The doc and awareness are created in state, the socket in the
  effect (`createLiveDoc` / `connectLive`).
- New dependencies: `yjs`, `y-prosemirror`, `y-protocols`, `ws`, `y-websocket`,
  `@tiptap/extension-collaboration`, `@tiptap/extension-collaboration-cursor` — all at versions
  that peer with TipTap 2.27 (the v3 question, `docs/PENDING.md`, is unchanged).
- The API imports `@tc/ui` for the editor schema, to turn stored JSON into a `Y.Doc` and back.
- Tests: `apps/api/test/collab.spec.ts` (two clients over a real socket, the store, the
  permissions), `apps/web/e2e/collab.spec.ts` (owner and co-author in two browsers).
- Not built: offline editing with later merge (the provider reconnects and pushes what it holds,
  which covers a dropped connection, not a day away), comments anchored to live text, and
  presence anywhere but the editor.
