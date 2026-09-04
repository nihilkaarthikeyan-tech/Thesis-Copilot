# ADR-0001 — Editor architecture

> **This file is a verbatim copy of PRD Appendix B** (`docs/PRD.md`, "Appendix B — Editor
> architecture decision record"). The PRD is the source of truth. If the two ever differ, the PRD
> wins and the difference is logged in `docs/BUILD_LOG.md` (PRD §0.3 rule 4).
>
> Copied on 2026-09-04 from PRD v1.1, lines 1831–1936.

---

## Appendix B — Editor architecture decision record (ADR-0001)

**Status:** Accepted. Applies from Phase 1 week 1. The agent implements exactly this; deviations require a new ADR (§0.3 rule 4).

### B.1 Decisions in one table

| Concern | Decision | Why |
|---|---|---|
| Editor framework | TipTap v2 on ProseMirror, React NodeViews where needed | Mature, extensible schema; decorations for ghost text; marks for provenance; large ecosystem |
| Document storage | ProseMirror JSON per `Chapter.content`; whole-chapter PUT on autosave | Chapters are ≤ ~50k words; whole-document saves are simpler and safe at that size |
| Ghost text | **Not** part of the document. A ProseMirror plugin holding `{ suggestionId, text, from, status }`, rendered as a `Decoration.widget` at the cursor | Undo history, autosave, word counts and provenance must never see unaccepted text |
| Provenance | A **mark** `provenance` with attrs `{ kind, actionId }`, `inclusive: false`, `excludes: ''` | Survives copy/paste and edits; can coexist with bold/italic; enables AI-usage log and style-profile threshold |
| Citation | An **inline atom node** `citation` with attrs `{ key, sourceId, chunkId, role, locator, prefix, suffix }`; rendered by a NodeView that reads the current style from editor storage | Atom = one unit for cursor/delete; NodeView allows re-render on style switch without touching the doc |
| Draft block | A **block node** `draftBlock` with attrs `{ draftId, status }` whose content is normal block content | Keeps the AI draft visually separate and reviewable; unwrapping on accept keeps the inner nodes and marks |
| Comment anchor (P3) | A **mark** `commentAnchor` with attr `{ commentId }`, `inclusive: false`; `Comment.quotedText` kept for re-anchoring | Marks survive most edits; quoted text lets us recover if the mark is lost |
| Collaboration | None (no Yjs) in Phases 1–3 | Guides comment; they do not co-edit. Keep all editor state inside the PM document or plugin state so Yjs could be added later |
| Math | KaTeX via `mathInline` / `mathBlock` nodes storing LaTeX source | Deterministic render; exportable |
| Images | `image` node storing an object-storage key + alt + caption; uploaded via signed URL | No base64 in the document |

### B.2 Schema (nodes and marks)

Nodes: `doc`, `heading` (levels 1–3; level 1 reserved for the chapter title and not insertable by the user), `paragraph`, `bulletList`, `orderedList`, `listItem`, `table`, `tableRow`, `tableHeader`, `tableCell`, `image`, `mathInline`, `mathBlock`, `codeBlock`, `blockquote`, `hardBreak`, `citation` (inline, atom, selectable), `draftBlock` (group: block; content: `block+`; defining; isolating), `needsSourceNote` (inline atom; attrs `{ text }`; rendered amber; only inside draftBlock).

Marks: `bold`, `italic`, `underline`, `strike`, `link`, `superscript`, `subscript`, `provenance`, `commentAnchor`.

Rule: a `citation` node's attrs are the only citation state in the document. `Citation` rows in the database are an index derived from the document on save (upsert by `chapterId + key`; delete rows whose key is no longer present). The document is the source of truth.

### B.3 Ghost-text plugin — behaviour specification

State: `{ status: 'idle' | 'requesting' | 'streaming' | 'shown', suggestionId, text, anchorPos, guided: boolean, abort: AbortController | null }`.

Triggers: `Ctrl/Cmd + /` (request), `Shift + →` (open guided input; on submit, request with instruction). In automatic mode (P2, opt-in) a 800 ms idle timer after a text-input transaction also requests, but only if the cursor is at the end of a text block or followed only by whitespace.

Request: only when `status === 'idle'`, selection is empty, the cursor is inside a `paragraph` or `listItem` (not inside `codeBlock`, `mathBlock`, a table header, or a `draftBlock` with `status !== 'accepted'`). Build `before` = text of the current block and up to ~1,200 tokens of preceding blocks (plain text with citations rendered as `{{cite:KEY}}` so the model sees them); `after` = up to ~300 tokens following the cursor. Send via SSE; set `status: 'requesting'`.

Streaming: on the first token, `status: 'streaming'`; append tokens to `text`; re-render the widget. The widget is a `span.ghost` with `contenteditable=false`, `aria-live="polite"`, and `user-select: none`.

Cancel: any transaction that changes the doc or moves the selection while `status !== 'idle'` aborts the request (`abort.abort()`), clears state, and reports outcome `REJECTED` (if text was shown) or `CANCELLED` (if not). `Esc` does the same with outcome `REJECTED`.

Accept all (`Tab` or `→` when `status === 'shown'`): insert `text` at `anchorPos` as text nodes carrying `provenance { kind: 'ASSIST', actionId: suggestionId }`; if the inserted text contains `{{cite:KEY}}`, replace each with a `citation` node (attrs from the server's `citations[]` in the `done` event); place the cursor after the insertion; report outcome `ACCEPTED` with `keptChars`. Show a 400 ms background fade on the inserted range (CSS class via a transient decoration).

Accept word (`Alt + →`): insert the first whitespace-delimited word (plus the following space), keep the remainder as the current suggestion, `anchorPos` advances; on the last word report `ACCEPTED`; if the user then cancels, report `PARTIAL` with the chars kept so far.

Keymap precedence: the ghost-text plugin is registered **before** list and table extensions so `Tab` is consumed only when a suggestion is shown; otherwise falls through to normal indentation.

Only one in-flight request per editor. The server also enforces this per user (409 if a request is already open) so a double-trigger cannot double-charge the cap.

Never: insert unaccepted text into the document, persist ghost state, or include it in word counts.

### B.4 Provenance mark — behaviour specification

- Attrs: `kind ∈ {HUMAN, ASSIST, DRAFT, COMMAND, HUMAN_EDITED}`, `actionId: string | null`.
- `inclusive: false` so typing at the boundary of AI text does not extend the AI mark.
- An `appendTransaction` plugin runs after every transaction: (1) any inserted text without a `provenance` mark gets `{ kind: 'HUMAN', actionId: null }`; (2) any text-replacing step that touches a range marked `ASSIST | DRAFT | COMMAND` re-marks the touched text nodes as `HUMAN_EDITED` (keeping `actionId`). Detection uses the transaction's step maps; do not diff the whole document.
- Paste: pasted content gets `HUMAN` unless it carries provenance marks from within the same document (internal paste preserves marks).
- Word counts by provenance are computed on save by walking text nodes; stored on `Chapter` as a JSON breakdown; these feed FR-8.6.
- The style-profile threshold (FR-4.7) counts `HUMAN` words only.

### B.5 Citation node — behaviour specification

- `key` is a stable random id generated at insert time; it is the join key to the `Citation` table row.
- Rendering: the NodeView reads `editor.storage.citations.style` and a `renderedMap` (key → string such as `(Kumar et al., 2021)` or `[12]`) computed by `packages/citations` from the document's citation order and the selected CSL style. On style change, the app recomputes `renderedMap` and dispatches a transaction with meta `{ citationsRerender: true }`; NodeViews re-render from storage. The document is untouched.
- Numeric styles: order is document order across chapters (chapter `order`, then position). Recomputed on save and on style change.
- Hover: a popover with source title, year, venue, and the supporting passage (`chunkId`) when present; "Open PDF at page N" link.
- A citation whose `sourceId` no longer exists in the library renders with a red dashed underline and tooltip "Source removed — click to fix or delete"; it is never auto-deleted.
- Copy/paste within the document preserves attrs; paste into another document creates a citation with `sourceId` unresolved (red) unless the same DOI exists in the target library, in which case it is remapped.
- Delete key on a selected citation removes the node; backspace immediately after a citation selects it first (standard atom behaviour).
- Export: `packages/export` walks the document, renders each citation via citeproc for the export style, and appends the bibliography.

### B.6 Draft block — behaviour specification

- Created by the Draft-mode job result: a `draftBlock { draftId, status: 'pending' }` containing the converted Markdown (headings become `heading` level 3, paragraphs, lists) with every text node marked `provenance { kind: 'DRAFT', actionId: draftId }` and citations as `citation` nodes; `[[NEEDS SOURCE: …]]` markers become `needsSourceNote` nodes.
- Insertion point: if the student invoked Draft from an outline node whose heading exists in the chapter, insert after that heading's content; else at the cursor's block boundary; else at the end.
- Only one `pending` draft per chapter. Invoking Draft again while one is pending prompts to accept or discard the existing one.
- A header bar (React NodeView) shows "AI draft — review before accepting" with buttons: **Accept draft**, **Discard**, **Regenerate** (counts as another `DRAFT` action; requires confirmation showing remaining cap).
- Accept: take a `DocumentVersion` snapshot (`reason: PRE_DRAFT_ACCEPT`), then replace the `draftBlock` with its children (unwrap). Marks and citation nodes survive. `needsSourceNote` nodes are converted to plain text `[NEEDS SOURCE: …]` with `HUMAN` provenance so they remain visible until the student handles them. Report outcome `ACCEPTED`.
- Discard: delete the node; report `DISCARDED`.
- Editing inside a pending draft is allowed; edited text becomes `HUMAN_EDITED` per B.4.
- Autosave persists pending drafts as part of the document (so a reload does not lose them).

### B.7 Autosave and versions

- Debounce 2 s after the last doc-changing transaction; also on `blur`, on route change, and every 30 s while dirty.
- PUT `/chapters/:id` with `{ content, baseVersion }`; server increments `version` and rejects with 409 if `baseVersion` is stale (another tab). On 409 the client shows "This chapter was changed elsewhere — reload to continue" and stops autosaving.
- A `DocumentVersion` snapshot is written by the server when ≥ 10 minutes have passed since the last snapshot and the content changed, and on `Ctrl/Cmd + S`, and before draft accept / scoped-revision apply.
- On load, if `localStorage` has an unsaved newer draft for this chapter (written on every debounce as a safety net), offer to restore it.

### B.8 Streaming transport

- `POST /assist/suggest` returns `text/event-stream`. Events: `start { suggestionId }`, `token { t }`, `done { citations: [{ key, sourceId, chunkId, rendered }], usage }`, `error { code, message }`. The client uses `fetch` + `ReadableStream` (not `EventSource`, which cannot POST) with an `AbortController`.
- Caddy must not buffer SSE: set `flush_interval -1` on the API route.
- Server sets `X-Accel-Buffering: no`, `Cache-Control: no-cache`.

### B.9 Tests required before week 1 is done

1. Ghost text never appears in `editor.getJSON()` at any point during a stream (unit, jsdom).
2. Accepting with `Tab` inserts text with `ASSIST` provenance and moves the cursor to the end (unit).
3. Typing while a suggestion is shown clears it and aborts the request (unit; assert `abort` called).
4. `Tab` without a suggestion still indents a list item (unit).
5. Typing at the end of an `ASSIST` range produces `HUMAN` text; editing inside it produces `HUMAN_EDITED` (unit).
6. Style switch APA→IEEE re-renders citation labels without changing `editor.getJSON()` (unit).
7. Draft accept unwraps the block and keeps citations and marks (unit).
8. Autosave 409 flow (integration).
9. E2E (Playwright): type a sentence, press `Ctrl+/` against the mocked provider, see ghost text, press `Tab`, reload, text persists with provenance.

---
