# ADR-0069 — The Chrome add-on, version 2: after saving, results pages, PDFs, the product's look

**Date:** 2026-10-05
**Status:** Accepted
**Builds on:** ADR-0031 (the add-on as first built). Everything there still holds unless this
record says otherwise.

## Why

The owner tried 0.1.0 beside Jenni's add-on and found it incomplete: after "Add to library" there
was nothing to do but go back to the publisher's site; it saved one paper at a time; it ignored the
PDF in front of the student; and it looked like a different product (a dark custom popup, a
generic document icon). The bar the owner set: professional and standard — features, security,
design.

## What 0.2.0 does

| | |
|---|---|
| **Open in Thesis Copilot** | After saving, the paper opens in the reader at `/app/d/{documentId}/sources/{sourceId}` (the in-app reader built in parallel). "Already in the library" opens the existing entry the same way. |
| **Collections** | An optional "Collection" picker under the thesis, with "New collection…" inline; the saved paper (or the one already there) joins it through `POST /collections/:id/sources`. The last thesis and collection are remembered. |
| **Results pages** | PubMed search results, arXiv listings and searches, and Google Scholar results list their papers with checkboxes; "Save (n)" saves up to 50, ten per request, with a progress bar and, per paper, Saved · Open / In library · Open / Failed with the reason written under it and "Retry failed". |
| **PDF tabs** | A tab showing a PDF offers "Attach this PDF". With a DOI (on the page or in the address, as arXiv's `/pdf/` and publishers' `/doi/pdf/` have) the paper is saved by DOI and the file attached (`POST /sources/:id/upload`); with nothing but the file, the file is the entry (`POST /documents/:id/sources/upload`). A PDF the site will not hand over is said so, and the paper is still saved by its DOI. |
| **Keyboard** | `Alt+Shift+P` opens the popup (`commands._execute_action`); the footer shows the shortcut Chrome actually assigned (`chrome.commands.getAll`), or "Set a keyboard shortcut". Every control is a real button, select or checkbox, focus is visible, and focus survives redraws. |
| **Right-click** | "Add to Thesis Copilot" on a link to a DOI, a publisher's `/doi/…` page or an arXiv abstract/PDF opens the same popup on that paper. |
| **Look** | The product's tokens (paper, surface, ink, muted, line, the cobalt accent, 6/10/14 px radii) and Satoshi, bundled; light and dark follow the system; the LogoMark and "Thesis Copilot" in the header; 360 px wide. |

Every state is drawn by `src/state.ts`, a pure state machine (reading → not a paper / loading →
signed out / no thesis / cannot reach → ready → saving → saved, already there, or failed with
retry). `apps/extension/store/states/` has a picture of each, light and dark.

## The decisions

- **The resolve route answers with the source ids.** `POST /documents/:id/sources/resolve`
  returned only counts. It now also returns `sourceIds`, one per reference in the order sent — the
  new row, or the existing row with the same reference text. Additive; the bibliography import
  keeps its old response shape. Test: `apps/api/test/resolve-source-ids.spec.ts`. No other API
  change was needed: collections, the two upload routes and the library list already existed.
- **Results are read from what the page shows, and from nothing else.** `collectResultList` runs
  only when the student clicks, only on the three hosts, and reads each result's title, byline line
  and the identifier its markup carries: PubMed's PMID and the DOI in its journal line, arXiv's
  abstract link, the link of a Scholar title. Nothing is fetched to fill gaps. **Google Scholar is
  never requested by the add-on** — its result page is read as it already sits in the tab — and
  because Scholar shows few DOIs, most Scholar results are saved by their reference text and the
  library's resolver either matches them strictly (≥ 0.85) or leaves them unresolved for the
  student to fix; it never guesses. The popup says so under a Scholar list.
- **The Scholar markup was not observed live in this build.** PubMed's and arXiv's were (one
  manual page load each, 2026-10-05, recorded as hand-written fixtures in `apps/extension/test/
  fixtures/`). Scholar's fixture follows its long-documented result markup (`.gs_r.gs_or[data-cid]`,
  `h3.gs_rt`, `.gs_a`) — the same classes reference managers read. If Scholar changes it, the list
  simply does not appear ("No paper on this page"); nothing wrong is saved.
- **A PubMed link cannot be right-clicked in, and a PubMed result without a DOI is saved by its
  text.** The library resolves by DOI or by reference text; a bare PMID is neither, and looking it
  up would need NCBI as a new host permission. Most PubMed records print their DOI in the result.
- **Batches of ten, at most fifty a save.** Resolve is rate-limited at twenty a minute per user
  (`HEAVY_RATE_LIMITS.search`); fifty papers is five requests. A failed batch fails only its own
  papers; 401 stops the save and shows "Sign in".
- **The save runs in the service worker**, which reports progress to the popup while it is open
  and carries on if it closes (ADR-0031's reason, now for a longer job).
- **The PDF is fetched by the service worker from the tab's address**, with the student's cookies
  for that site, as their own request for a file they are looking at. `activeTab` grants the
  extension temporary access to the tab's origin when the student clicks; whether that covers a
  `fetch` from the service worker in every case is **not proven by automation** — the browser
  test's build has a host permission for its fixture server. If Chrome or the site refuses, the
  student is told and the paper is saved by DOI. No broad host permission was added to make this
  certain: that would mean "read and change all your data on all websites" at install, for a
  convenience.
- **The bytes decide what a PDF is.** The add-on checks `%PDF-` and 50 MB before uploading; the
  site's own `checkUpload` then applies the plan's size and the library-PDF allowance and its
  message is shown as it is.
- **Right-click uses the `contextMenus` permission.** Weighed against store review: it shows no
  install warning (Chrome lists none for it), it is limited by `targetUrlPatterns` to DOI and arXiv
  links, and it is justified in `STORE.md`. The click hands the link to the popup through
  `chrome.storage.session` (memory only, gone when the browser closes, taken within two minutes)
  and opens it with `chrome.action.openPopup()` — available to every add-on from Chrome 127, so
  `minimum_chrome_version` is now 127. When Chrome cannot open it (no focused window), the badge
  shows "1" and the next click on the icon shows the paper.
- **The shortcut is Alt+Shift+P, not Alt+Shift+T.** On Windows, Alt+Shift+T is Chrome's own "focus
  the toolbar", and Chrome's shortcuts win. P for paper. The student can change it at
  `chrome://extensions/shortcuts`; the footer shows whatever is assigned.
- **The icon is the LogoMark, rasterised by Chromium.** `static/icons/icon.svg` is the LogoMark's
  drawing in its light colours; `scripts/icons.mjs` renders 16, 32, 48 and 128. The 128 follows the
  Web Store rule (96×96 artwork in 16 px of transparent padding a side); 48 keeps that proportion;
  16 and 32 are edge to edge, because Chrome already pads the toolbar button and at 16 px the T
  needs every pixel. The navy tile is the light-theme mark; on a dark toolbar its white T and blue
  dot carry it (the PNG cannot switch with the theme the way the site's SVG favicon does).
- **Satoshi is bundled** (`static/fonts`, the same three woff2 files the site self-hosts under the
  ITF Free Font License). No remote fonts, no remote anything.

## Security

- **Permissions:** `activeTab`, `scripting`, `storage`, `contextMenus`; host permission for
  `https://thesis.rademics.ai/*` only. No `tabs`, no `<all_urls>`, no content script. Each is
  justified in `STORE.md`.
- **Content security policy:** stated in the manifest for a reviewer to see —
  `script-src 'self'; object-src 'self'; base-uri 'none'; frame-ancestors 'none'`. No remote code,
  no `eval`, no inline script (popup.html loads `popup.js` only). All code is in the package; there
  are no runtime dependencies at all.
- **Credentials:** the site's own session cookie (`credentials: 'include'`); no token or password is
  ever stored. 401 anywhere is the "Sign in" state.
- **Untrusted page data:** every page value is text, checked before it is sent — DOIs against a
  strict shape (no spaces, quotes, angle brackets or backslashes; at most 200 characters), arXiv ids
  and PMIDs against theirs, titles and names stripped of control characters and cut to length. The
  popup writes everything with `textContent`; the only markup is the static `popup.html`. An id
  from the API reaches a URL path only after a UUID check. Only this add-on's own pages can message
  its service worker (`sender.id` is checked).
- **Talks to:** `https://thesis.rademics.ai` and, for "Attach this PDF", the address of the
  student's own tab. No analytics, no third parties.
- **Stores:** the last thesis and collection (`chrome.storage.local`), and for at most two minutes
  in memory a right-clicked link. Nothing else.

## Not done

- **Firefox and Safari:** still Chrome and Edge only.
- **Publishing:** needs the owner's developer account. `apps/extension/PUBLISHING.md` is the
  step-by-step; `STORE.md` the text to paste; `store/` the pictures.
- **Creating a thesis from the popup.** "Start a thesis" opens `/app/new`; a thesis needs more than
  a title to be useful, and the site's own screen asks for it.
