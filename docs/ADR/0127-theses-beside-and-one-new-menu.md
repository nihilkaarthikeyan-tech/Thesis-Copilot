# 0127 — The theses beside the open one, and one New menu

Date: 2026-10-08
Status: accepted (Jenni build plan Round 3, R32; inventory §3, §8)

## Context

Jenni keeps the student's documents in a side panel next to the open document (search, a row
per document, **+** for new), and one **New ▾** menu: create or import a document, an AI chat with
no document, Upload to the library. Ours listed theses only on `/app`, a page away from the
editor: switching thesis meant the "Theses" crumb, the list, then Write. Beginning one had three
doors in three places — the list's own form, a "Start from a paper" button in the list header
(which opened `/app/new` on the paper path) and, on `/app/new`, "Create and import from Word".

## Decision

- **"Theses" at the top of the chapter rail** (`components/editor/ThesisSwitcher.tsx`), above
  "Chapters", which is untouched — same list, same `grid-cols-1` / `min-w-0` rows, same Import
  from Word for the open thesis. A heading that folds open; open, it lists every thesis on the
  student's list from `GET /documents`, the open one marked "Open now" (`aria-current`), the
  others with their last update. A click goes straight into that thesis's writing: the chapter
  last open here for it, else its first — the same place the list's Write goes, now one helper
  (`lib/thesis-href.ts`, `thesisWriteHref`). "All theses" goes to `/app`, where copy, archive and
  delete stay. Above five theses a "Find a thesis" filter appears (Jenni's search, in the
  browser: the list is already loaded).
  - **Folded by default, remembered in this browser** (`tc:rail-theses-open`, every access in
    try/catch). A student with one thesis loses no rail space to it; one who uses it keeps it
    open. The list is read when first unfolded, not on every chapter load.
  - **A side section, not a second rail.** The editor already has the chapter rail on the left
    and the tool panel on the right; a third column would squeeze the page at 1024 px. Long
    titles truncate in one line with the full title as a tooltip; the list scrolls inside itself
    past about eight rows.
  - **On a phone** it is in the chapter drawer, as the rail is.
- **Archived theses are not in it.** `GET /documents` leaves them out (ADR-0114), so the switcher
  needs no rule of its own. A thesis opened by an old link while archived is simply not marked;
  the list's archive is where it is restored.
- **One New ▾ menu** (`components/NewMenu.tsx`), in the list header in place of "Start from a
  paper", and beside "Theses" in the editor's rail. Three items, each a link to the existing
  `/app/new` chooser with its starting point already chosen (`?start=`):
  - **New thesis** → `?start=topic` — "a topic" ticked, Start writing now first, as before;
  - **Upload a paper** → `?start=paper` — "a paper I have written" ticked: the B_PAPER path,
    whose proposal screen takes the upload;
  - **Import from Word** → `?start=word` — a line says what to do, and "Create and import from
    Word" is the first and filled button, first in the page too, so Enter in the title imports.
    The thesis opens with the existing Word import dialog up (`?import=word`, unchanged).
  Nothing is created until the student presses a button on `/app/new`. The list's own
  new-thesis form ("Start another thesis", and the form a first-time student sees) is unchanged.
- **The menu stays inside the window.** It is measured when it opens and moved back inside an
  8 px margin; that matters because the list header wraps on a phone, putting the button on the
  left, and in the rail the button sits at the rail's right edge.
- **In the editor, "Import from Word" means a new thesis**, as every item of New does; bringing a
  `.docx` into the open thesis stays where it was, under the chapter list. The menu's hint says
  "A new thesis from the chapters in a .docx" so the two are told apart.
- **`list.startFromPaper` is gone** (en and hi; the Hindi review sheet regenerated). The new
  strings have Hindi beside them, for the native speaker's review with the rest (PENDING).

No new API, no migration, no model call, no allowance.

## Not done

- **A chat without a thesis** (Jenni's "AI chat" in New). Our chat is grounded in one thesis's
  library — the model may only cite passages in the request (§10.6) and the off-topic floor
  measures against that library — so a thesis-less chat needs its own grounding rules first. It
  is R30's, not this item's.
- **Upload to the library** from New: a paper belongs to a thesis's library, so Jenni's account
  library upload has no home here yet; the library tab in the editor and the B_PAPER path are the
  ways in.
- Jenni's per-row menu in the panel (open in new tab, duplicate, archive) — those stay on the
  list; a middle-click opens a row in a new tab as any link does.

## Evidence

- `pnpm --filter @tc/web typecheck`, the web unit suite and `pnpm lint` (below in the commit).
- `apps/web/e2e/documents-beside.spec.ts`, written, **not yet run**: three theses, one archived;
  the rail's Theses folded, then two listed with the open one marked and the archived one absent;
  measured open (and with the rail's New open, which must sit inside the window) at
  1440/1280/1024/768/390 px with a long title, the phone in the chapter drawer, and the list's New
  open at each width; a click switches to the other thesis's chapter; each New item lands on
  `/app/new` with the right starting point ticked, Word's button first.
- `apps/web/e2e/layout.spec.ts` now also measures the editor with Theses open at 1280 and 1024.
- `path-a.spec.ts` and `_measure/demo-advert.spec.ts` reach the chooser through New → Upload a
  paper instead of the removed button.
