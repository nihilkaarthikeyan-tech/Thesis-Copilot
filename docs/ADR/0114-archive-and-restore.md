# 0114 — Archive and restore a thesis; a copy named "… (copy)"

Date: 2026-10-08
Status: accepted (Jenni build plan Round 3, R29; inventory §3, §13.9)

## Context

Jenni's documents can be archived from the row menu and restored from an archive popover (with a
red permanent Delete beside Restore). Ours could only delete a thesis for good or copy it, and the
copy was named "Copy of …" — Jenni gives the copy the same title, which leaves two identical names
on the list. A student with a finished, abandoned or test thesis had to keep it on the list or
lose it.

## Decision

- **`Document.archivedAt`** (migration `0043_document_archive`). Archiving sets it, restoring
  clears it, and that is all either does: no row, file, share, version or job is touched. Neither
  goes near `DocumentEraser`, the one place a thesis is removed.
- **`POST /documents/:id/archive`** and **`/restore`**, owner only (anyone else gets the usual
  404), free, idempotent (a second archive keeps the first date and writes no second audit line).
  Each writes `DOCUMENT_ARCHIVED` / `DOCUMENT_RESTORED` to the activity log, by the student.
- **`updatedAt` is written back as it was**, so archiving and restoring do not read as an edit:
  a restored thesis returns to the place on the list its writing gives it, with the same
  "updated …" date.
- **`GET /documents` leaves archived theses out; `GET /documents?archived=1` lists only them**,
  last archived first. Every summary carries `archivedAt`.
- **The list** (`/app`): **Archive** sits in each card's More menu, beside Make a copy, so the
  card's row of links (fixed for phones in the layout audit) does not grow. No confirmation —
  nothing is lost — but a line says "… is archived: off this list, nothing deleted" with **Undo**.
  **Archived theses (N)** at the foot of the page unfolds the archive: each row has the title, the
  date it was archived, **Restore**, **Open** and **Delete** (the same dialog and route as the
  list's Delete). Jenni's archive is a popover; a section reads better on a phone. Jenni's Restore
  also opens the thesis; ours puts it back on the list, where Write is one click. A student whose
  every thesis is archived sees "Every thesis is archived", not the first-run hint.
- **The copy is "<title> (copy)"** (`copyTitle`). A title too long for the suffix is shortened
  before it, so the copy still says what it is. A copy of an archived thesis is on the list.

### Every place that lists theses, and what an archived one does there

| Place | Decision |
|---|---|
| The thesis list `/app` | Hidden; under "Archived theses" with Restore. |
| "Continue writing" and the return to the last chapter (ADR-0073) | Not offered: both only follow a thesis on the list. |
| The Chrome add-on's thesis picker | Hidden, with no add-on change: it reads `GET /documents`. A thesis remembered as "last used" that is now archived falls back to the first on the list, as for a deleted one. |
| Opening it by its link (editor, build, viva, …) | Still opens. Archiving hides a thesis; it does not lock it. |
| A guide's or co-author's share, the read-only link, `/guide/documents` | Unchanged. Archiving is the student's own tidying, not a decision about who may read; removing access is still done in Share. |
| Running jobs (a chapter build, automatic sources, a long-job email) | Finish as before. |
| Admin → a user's theses | Listed, marked **Archived**: it is still stored, and an admin deletes or reads it as before. |
| Admin counts (users' thesis counts, the overview total), institution seats, the pilot report, a guide's "has no thesis of their own" check | Count it: the thesis exists. |
| Account erasure | Erased with the rest. |
| Delete | Works from the archive as from the list. |

## Not done

No notice inside the editor that the open thesis is archived; a student who opens one by an old
link sees it as normal, and the list's archive is where it is restored.

## Evidence

`apps/api/test/document-archive.spec.ts` (7 tests, real application): archiving moves the thesis
from `GET /documents` to `?archived=1` with its row, chapters, memory and `updatedAt` unchanged
and one audit line; a second archive keeps the date; the thesis still opens and the guide's share
still reads it; a stranger gets 404 and a signed-out caller 401; a copy of the archived thesis is
on the list as "… (copy)"; restore puts it back in its old place with `updatedAt` unchanged, and
a second restore is a no-op; an archived thesis deletes for good. `document-copy.spec.ts` updated
for the new name. `apps/web/e2e/archive.spec.ts` (not yet run): archive from More, Undo, archive
again, the archive measured at 1440/1280/1024/768/390 px with a long title, Open, Restore.
