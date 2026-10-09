# 0129 — Papers filed where they are added

Date: 2026-10-09
Status: accepted (Jenni build plan R18, the open half; extends ADR-0105)

## Context

ADR-0105 put **Add into** on the library's add row: a file, Zotero, a PDF or an ID goes straight
into the chosen collection. It left out every other way a paper enters the library — Discover's
"Add selected" (on the same screen, but its own panel), and in the editor the Papers tab's "Add to
library" (before "Cite here"), chat's Add on a search result, Add and "Add all" on papers an
answer found beyond the library, and a pasted reference accepted on the Citations tab. Those still
needed the second step (find the paper, tick it, Add to). The choice itself lived only in the
library screen's state, so it was gone on reload and unknown to the editor.

## Decision

- **The choice is kept on the thesis**, in `Document.meta.addInto` (the existing per-thesis JSON,
  written with `setMetaKey`; no migration). `GET /documents/:id/add-into` reads it — a collection
  deleted since is answered as none — and `PUT` stores `{ collectionId | null }`, refusing (404) a
  collection that is not this thesis's.
- **Each add route takes an optional `collectionId`**: `POST /documents/:id/sources/resolve`
  (chat, the Papers tab), `POST /documents/:id/search/:runId/select` (Discover) and
  `POST /documents/:id/citations/accept` (a pasted reference). `LibraryFilingService`
  (`apps/api/src/common/library-filing.ts`) checks the collection **before** the add, so a bad id
  adds nothing, then files the rows the add produced — a paper already in the library included —
  and the answer carries `filedIn: { id, name } | null`.
- **The request names the collection; the server never files from the stored choice on its own.**
  The web sends `collectionId` on every add, `null` for "The library only". So an add from
  somewhere that shows no picker (the Chrome add-on, which files with its own control after
  ADR-0069's resolve; automatic sources, ADR-0037; a chapter build's searches) is never filed
  behind the student's back.
- **The same control wherever the student adds** (`components/sources/AddInto.tsx`:
  `useAddInto` + `AddIntoPicker`): the library's add row (now persisted; Discover on that screen
  uses it), the Papers tab under the search box, above chat's search results, and above a parsed
  reference list. Changing it anywhere changes it for the thesis. In the 288 px side panel the
  select has no width of its own (`w-0 flex-1`), so a 60-character collection name cannot widen
  the panel. Papers an answer found beyond the library use the same stored choice; the picker is
  not repeated under every answer.
- The library row's own adds keep ADR-0105's before/after comparison (it already worked, and the
  upload and import routes are multipart); only where the choice comes from changed.

Not an add, so not filed: R19's "Keep in my library" (the papers are already in the library;
it only clears the automatic mark).

## Evidence

`apps/api/test/papers-filed-where-added.spec.ts` (7, real API and database): the choice stored,
read back, refused for another thesis's collection, forgotten when its collection is deleted;
resolve files a new paper and files an existing one into a second collection; without a
collection nothing is filed; another thesis's collection is a 404 and adds no row; Discover's
select and a pasted reference's accept file theirs. `apps/web/test/add-into.spec.ts` (9): the body
carries `collectionId` (null for none, a stale choice dropped), the notice, and that every add call
in Discover, the Papers tab, chat (both) and the Citations tab goes through `withCollection` with
the picker on that screen. The chat e2e specs now expect `collectionId: null` on the resolve body.
