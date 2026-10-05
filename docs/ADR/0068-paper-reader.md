# 0068 — A paper reader inside Thesis Copilot

Date: 2026-10-05
Status: accepted
Follows: the "Read beside" pane (2026-10-04) and coverage map row 34.

## Context

The owner (2026-10-05): a student adds a paper — from the Chrome add-on, Find papers, a `.bib`, an
upload — and then cannot read it here. The library's title went to the publisher's site. "Read
beside" showed the PDF in an iframe on the signed storage link, which works in development and is
**blank in production**: the shared host nginx sends `X-Frame-Options: DENY` on storage links,
and that nginx is not ours to change. Jenni has a reader: open any saved paper in the app, search
it, select a passage and copy it with its citation or quote it to chat.

## Decision

**The route is `/app/d/:id/sources/:sourceId`**, exactly — the Chrome add-on deep-links to it.
`lib/reader.ts` `readerHref` is the one place the app spells it (`?page=N` opens at a page,
`?chunk=<SourceChunk id>` marks a citation's passage, `?view=text` asks for the Text view).

**The PDF is drawn on our own page with pdf.js, never framed.** The bytes come through the API:
`GET /sources/:id/file/content` streams the object from storage (`application/pdf`,
`Content-Disposition: inline`, `Cache-Control: private, max-age=300`, the length), fetched by the
page with the session cookie. No storage link reaches the browser, so no presigned URL can be
handed to anyone, and `X-Frame-Options` on storage never applies. Fetching the existing presigned
URL with `fetch()` was rejected: it would need CORS on the bucket (served through the same host
nginx we may not touch) and would put a bearer link in the page.

**`pdfjs-dist` 6.3.289, pinned, in `apps/web` only.** It was not in the lockfile: `unpdf` (the
worker's extractor) bundles a serverless pdf.js build that has no canvas renderer and no text
layer. The branch first pinned 5.7.284, the last 5.x. CI's `pnpm audit` refused it: versions
5.6.83 to 6.2.107 carry a high advisory (GHSA-hq66-cqwq-w95j, arbitrary JavaScript on opening a
malicious PDF), and this reader opens PDFs from publishers and uploads. 6.3.289 is patched and was
five weeks old at release; 6.4 was two days old. The only API change the reader met is that a
document is released through `loadingTask.destroy()`. pdf.js is loaded with a dynamic `import()` on first use,
so no other page pays for it, and the worker is `new URL('pdfjs-dist/build/pdf.worker.min.mjs',
import.meta.url)` — webpack emits it as `/_next/static/media/pdf.worker.min.<hash>.mjs`, served
from this site, which the existing CSP (`worker-src 'self'`) already allows. Proven under
`next build` + `next start` with the production CSP (no `unsafe-eval`; pdf.js 5 has no eval path).
The text layer's CSS is the text-layer part of `pdfjs-dist/web/pdf_viewer.css` (Apache-2.0),
copied into `globals.css` — the other 7,000 lines style pdf.js's own viewer, which is not used.
No `standardFontDataUrl`/`cMapUrl` is served: a PDF that relies on the 14 standard fonts draws
with system fonts (correct text, slightly different glyphs), and a CJK PDF without embedded fonts
may draw poorly. The Text view covers both. The optional `@napi-rs/canvas` dependency of
`pdfjs-dist` is for Node only; the browser never loads it.

Pages are drawn only within one and a half screens of the viewport and cleared when far away;
each drawn page gets pdf.js's `TextLayer`, which makes it selectable and searchable. Zoom: Fit
width (the default), −, + (50–300%), "Page x of N".

**Text view** for every paper: the `SourceChunk` rows in order (`GET /sources/:id/text`), set in
Spectral at the 72ch measure like the thesis, with page markers and section headings. The chunker
overlaps consecutive chunks by ~15%; `reader-text.ts` cuts each chunk at the end of the one before
by `charStart`/`charEnd`, so no sentence shows twice. This is all an abstract-only paper has, and
the fallback when a PDF cannot be drawn. PDF | Text is a toggle when both exist.

**Search** (Ctrl/Cmd+F, Enter / Shift+Enter, Esc) works in both views and counts "x of y". In the
PDF every page's text is read once with `getTextContent`, so matches on pages not yet drawn are
counted; moving to one draws its page and marks it. Matches are drawn with the CSS Custom
Highlight API — no `<mark>` is inserted, so pdf.js's positioned text layer is never disturbed. A
browser without the API still counts and moves; it draws no colour.

**Honest states**, from `GET /sources/:id` (`reading`): *Still being looked up* / *Still being
read — this page updates when it is ready* (polled every 3 s; "being read" means an `index-source`
job for the paper is waiting or running, found by scanning the unfinished jobs rather than
guessing the several job-id shapes it is enqueued under); *We hold only the abstract* (with "Add
the PDF" — the existing `POST /sources/:id/upload` — and "Publisher's page ↗"); *We hold no text*;
*We could not read this PDF* (with the reason the library already gives). Full text wins over
"looked up": an uploaded PDF is read before its record is identified, and its text is there.

**Selection actions** (a small menu over the selection with a mouse; a bar at the foot of the
screen on a touch screen, where the phone's own menu sits over the selection):

- **Copy with citation** — the passage in curly quotes, then the label from
  `GET /documents/:id/citations/quote?sourceId&page`: citeproc over the thesis's citations with
  this one appended last, the page as its locator. So the label is the thesis's own (APA
  disambiguation, the source's existing number in a numeric style, the next number if uncited). A
  note style is rendered alone — appended after a note for the same paper it would read "Ibid." —
  and goes on its own line. Nothing is assembled by hand.
- **Cite in my chapter** — the simplest robust option: a one-minute hand-off in this tab's
  session storage, then the editor of the chapter the student was last writing in this thesis
  (`last-chapter.ts`, else the first). The editor shows a bar, "Citing Kumar 2021, p. 4 — click in
  your chapter where it goes, then press Cite here". The editor does not keep a caret between
  visits, so inserting "at the last cursor" would mean guessing; one click is the honest version.
  The node carries the passage (`chunkId`, from the Text view) and the page as its locator.
  Nothing enters the chapter without the press (flag, don't fix).
- **Ask chat about this** — the same hand-off; the editor opens the chat with the passage in the
  box (ChatPanel's existing `prefill`) and the paper @-named (`prefill.mention`), unsent.

**Entry points:** every library row's title is a link to the reader, plus "Read"; the DOI is kept
as a link marked ↗, and "Open PDF" became "PDF file ↗". The editor's Sources tab: "Open in reader"
on every row. The citation hover card: "Open in reader" on every citation (new `readerHref` option
in `packages/ui`), at the cited page with the passage marked. Find papers and chat's web results:
"Read" once the paper is in the library. A chat answer's passage opens in the reader's Text view,
marked (it opened the library list before).

**Read beside, decided cleanly:** the pane keeps its place and resize handle but now draws with the
same `PdfView`, so it works in production too; its header link is "Open in reader". On a screen
too narrow for the pane, "Read PDF" opens the reader in a new tab instead of the raw storage link
(which a phone downloads rather than shows). Nothing is framed any more, so the CSP's `frame-src`
no longer lists the storage origin.

**Who may read: the owner only.** Every `/app/d/:id` screen is the owner's (`GET /documents/:id`
is owner-scoped); a co-author or reader (ADR-0057) works through `/guide/:token`, which has no
library. So the new routes are owner-only like `GET /sources/:id/file`, and anyone else gets the
same 404 as an id that never existed. Letting a co-author read the library's papers would be a
reader under the guide routes — a separate decision, not made here.

The file routes (`/sources/:id/file` and `/file/content`) get their own limit: 60 a minute per
user (`HEAVY_RATE_LIMITS.file`), on top of the general 600.

## Not done

- A highlight *inside the PDF* is drawn for search and for a citation's passage, but a student
  cannot save highlights or notes on a paper (Jenni can annotate). Not asked for here.
- The reader does not open for a co-author (above).

## Tests

API (testcontainers, `apps/api/test/paper-reader.spec.ts`, 13): the owner gets the PDF's exact
bytes with `application/pdf`, inline, `private`, the length; another student and an unknown id
get 404 with no bytes; a paper with no file 404; no session 401; the route is counted as `file`;
`GET /sources/:id` gives the record, collections, `reading` and never the storage key; the text
comes back without the overlap; the quote label follows the style (APA with the page, IEEE `[1]`)
and refuses a missing id and another student. Unit: `reader-text.spec.ts` (overlap cutting and the
reading state), `apps/web/test/reader.spec.ts` (address, passage cleaning, quotation, search index,
"x of y", hand-off parsing, library matching), `packages/ui` hover card "Open in reader".
Playwright `e2e/paper-reader.spec.ts` (8) — open from the library, pdf.js canvas with ink and a
text layer, no iframe; Ctrl+F "1 of 3" → "2 of 3", no matches, the Text view too; a citation's
passage marked in the PDF; select → Copy with citation puts `“…” <label>` on the clipboard; Ask
chat and Cite in my chapter through the editor; the abstract-only paper (seeded through
`e2e/_db.ts`, because reaching that state through the API needs a real Crossref record); a phone —
and `e2e/read-beside.spec.ts` rewritten for the drawn pane. All passed against `next build` +
`next start` with the production CSP.
