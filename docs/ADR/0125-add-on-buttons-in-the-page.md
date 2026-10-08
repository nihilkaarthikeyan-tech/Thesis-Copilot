# 0125 — "Add to Thesis Copilot" buttons inside the page (add-on 0.3.0)

Date: 2026-10-08
Status: accepted (Jenni build plan R39; inventory §13.11). Builds on ADR-0031 and ADR-0069, which
still hold unless this record says otherwise.

## Context

Jenni's extension needs no toolbar step: it puts "Add to Jenni" into the page — beside the DOI on
MDPI, arXiv and PubMed article pages, and on every Google Scholar result — and the button opens a
panel with the item, Cited by, Open Access and "File: PDF found". Seen first-hand (§13.11) it also
**saved an MDPI journal issue instead of the article**, failed a save with no reason ("Save
failed"), and left a retried save on "Processing PDF…" for good. Ours (0.2.1) was the toolbar
popup and the right-click item only.

The owner (2026-10-08): build it now as add-on 0.3.0, with the fewest new permissions, and submit
it only after 0.2.1's store review is approved.

## Decision

**A content script on five hosts, nothing wider.** `src/hosts.ts` is the one list; the build writes
it into the manifest's `content_scripts.matches` and the service worker answers a content script
only from these hosts.

| Match pattern | Why |
|---|---|
| `https://scholar.google.com/scholar*` | A button on every Google Scholar result (Scholar's results path only — no other Google page) |
| `https://scholar.google.co.in/scholar*` | The same, on Scholar's India domain (the product's market). Other country domains keep the toolbar button |
| `https://pubmed.ncbi.nlm.nih.gov/*` | PubMed search results and article pages |
| `https://arxiv.org/abs/*`, `/list/*`, `/search/*` | arXiv abstract pages, listings and search results |
| `https://www.mdpi.com/*` | MDPI article pages (an issue or journal page gets no button; see below) |

No `<all_urls>`, no `tabs`, no `webNavigation`, no new `host_permissions`, no
`web_accessible_resources`. **"Beside the DOI on any article page" does not need more**: every
other article page keeps the toolbar button (`activeTab`, `Alt+Shift+S`), which reads the same
tags when the student clicks. A button on every site would mean "Read and change all your data on
all websites" at install; that, or an opt-in optional host permission, is left for the owner to
ask for (Not done).

The install warning grows from the one host to the five sites as well (Chrome words it; not
observed in this build). Chrome disables an installed 0.2.x until the student accepts the new
permission (`PUBLISHING.md` §7a).

**The right item, every time.** A button is tied to an identifier the page itself states
(`src/refs.ts`): on an article page the DOI `paperFrom` reads from its own tags (`citation_doi`
first, never a `citation_reference`), the arXiv id of an abstract's address, the PMID of a PubMed
article's address; on a results page, each result's own PMID, arXiv id or the DOI its link
carries. **A title alone never makes a page an article**, and links on the page are never followed
or guessed from — so an MDPI issue's table of contents, which lists articles and names none in its
tags, gets no button at all. The article's button sits beside the first *visible* link to *that*
DOI (not a hidden "cite" box's copy, not a reference's), or under its title when the page shows no
DOI link; with neither, no button (the toolbar still works).

**The card** (`src/inpage.ts`, states in `src/card.ts`): fixed at the top right of the window,
Escape or × closes it. It looks the paper up with the library's own paste-an-ID preview
(`GET /documents/:id/sources/lookup-id`, ADR-0103) — trying the identifiers in order (DOI, then
PMID) — and shows the record found: title, authors, year, venue, "✓ Details found in
Crossref/arXiv/PubMed". Save waits for the lookup, so what is shown is what goes in.

- **Saving** goes through `POST /documents/:id/sources/import-id` with the identifier the lookup
  found a record for: the server reads the record again rather than trusting the page, and a DOI
  already in the library is "Already in the library", not a second row. Only when there is no
  record for any identifier (404), or a Scholar result names none, does the paper go the popup's
  way — `runSave`, through `resolve`, by its details and DOI — saying so beforehand. Then the
  chosen collection; then "Open in Thesis Copilot" (the reader) and "Open the library". PubMed
  results without a DOI, which 0.2.x could only save by their text, now go in by PMID.
- **Facts, only when stated**: "Cited by N on Google Scholar" (the result's own link), "Cited by
  N (Crossref)" (the lookup), "Open access on arXiv" / "Free in PubMed Central" (the lookup),
  "PDF: Found on this page" (Scholar's [PDF], arXiv's PDF link, a `citation_pdf_url` tag). A row
  nobody stated is not drawn; nothing is defaulted. The add-on does not fetch that PDF (the page
  did not load it); the card says to open it and use the toolbar button to attach it.
- **Nothing fails silently.** Every refusal is written out with its reason (the API's problem
  detail) and Try again; 401 is "Sign in"; no thesis is "Start a thesis"; the lookup has a 25 s and
  the import a 45 s limit, after which the card says Thesis Copilot took too long.
- The thesis and collection are the popup's (`chrome.storage.local`, the same two keys).

**One small API addition.** The lookup already read Crossref's `is-referenced-by-count` and
PubMed's PMC id and dropped them; `PaperPreview` now carries `citedBy` (Crossref's count, DOI
lookups only, null when absent — never 0 by default) and `openAccessVia` (`'arXiv'`, `'PubMed
Central'` or null for "not stated"). Additive; the web's Paste an ID ignores them. No new route.

**What it reads and sends.** In the page: the meta tags and each result as `page.ts` already
reads them for the popup (`collectResultList` can now also hand back each result's element). No
request to the site — Google Scholar in particular is read as it sits in the tab, a robot-check
page has no results and so shows no buttons, and nothing on it is touched. To Thesis Copilot: the
identifier, and only for a result with none the reference line the popup has always sent. The
site's privacy page (`/privacy`, "The Chrome add-on") gains a paragraph saying exactly this for
0.3.0; that site release must be live before 0.3.0 is submitted. `STORE.md` and `PUBLISHING.md`
§7a have the store wording and the update steps.

**Security.**
- The buttons and the card live in **closed** shadow roots: the page's CSS cannot restyle them and
  its scripts cannot read the card (the student's thesis titles). Everything is written with
  `textContent`; the logo is built element by element. Styles go in two ways at once — a `<style>`
  in each shadow root and a constructed sheet, which a page's CSP on inline styles cannot refuse —
  so either one is enough (neither observed in a real Chrome in this build; at worst a button
  shows unstyled and still works).
- A content script runs inside someone else's page, so the service worker treats it as input
  (`senderMay`, `checkSaveOneJob`): from a content script it answers only `theses`,
  `collections`, `lookup` and `save-one`, only from a tab on the five hosts; the identifier must be
  exactly one the cleaners make; ids must be UUIDs; the paper is clipped text. The popup's bulk
  save, which can fetch a PDF from an address, is never run on a content script's word.
- A click on the button never reaches the page's own handlers; key presses in the card do not
  trigger the page's shortcuts.

**Layout.** The button is an inline box (`inline-block`, `max-width: 100%`, the label ellipsised)
that wraps like a word in the row it joins — Scholar's Save · Cite · Cited by row, PubMed's
citation line, arXiv's id line, or after the DOI link. The card is `position: fixed`, 360 px and
never wider than the window less 32 px, its own scroll inside 100vh − 32 px; it takes no room in
the page. The host elements' own styles are inline `!important`, the one place page CSS could
reach.

**Build.** Chrome loads a content script as a classic script, not a module, so `content.ts` and
what it imports are joined into one `content.js` by esbuild (`0.28.2`, already in the lockfile
through the test tools; now a declared dev dependency) — not minified, file names relative to the
package. Everything else is still tsc output as before. `--open-shadow` (development builds only)
opens the shadow roots for the browser test.

## Evidence

Unit tests (`pnpm --filter @tc/extension test`, 112 in 12 files, 55 new), against **hand-written
structural fixtures** — not copies of third-party pages, each labelled at its top:
`test/fixtures/{mdpi-article,mdpi-issue,arxiv-abstract,pubmed-article,scholar-buttons}.html`
plus the 0.2.x PubMed/arXiv fixtures.

- `refs.spec.ts` (10): the identifiers per page kind; a title-only page and an issue page are no
  article; tampered identifiers refused.
- `inpage.spec.ts` (19): MDPI article → one button beside the visible header DOI link, not the
  hidden copy or a reference; MDPI issue → none; arXiv abstract → beside `#arxiv-doi-link`, by
  arXiv id; PubMed article → beside its DOI link, DOI then PMID, under the h1 when no DOI; Scholar
  → four buttons in the right rows with Cited by and [PDF] read, none on a profile row, none (and
  the page untouched) on a robot check; PubMed and arXiv results → one each, results added later
  get theirs once; closed shadow roots; the card's lookup sends only the identifier; DOI 404 →
  PMID; not-found → saved by details with the DOI; a refusal's reason and Try again; signed out;
  Escape returns focus and a save started still updates the button; the card's fixed geometry.
- `card.spec.ts` (7), `save-one.spec.ts` (8), `api-inpage.spec.ts` (7), `hosts.spec.ts` (4).
- API, run against its Testcontainers stack: `paper-id.spec.ts` (4, one new: Crossref's count
  passed on, nothing stated for a book) and `paper-id-facts.spec.ts` (1, new) — 6 of 6 with
  `paper-id-names.spec.ts`.
- `apps/web/e2e/extension-inpage.spec.ts` (written, **not run** in this build): the dev build
  loaded into Chromium, the four sites served from these fixtures by `context.route`, buttons
  counted, a save through the real API checked in the library, no horizontal overflow at 390 and
  1440 px.

Found on the way: `checkPaper` clipped a five-digit "year" to four digits before checking it, so
"20255" became 2025; it now checks the whole value.

## Not done, not verified

- **Not run in a real Chrome against the real sites** (this build was told not to open them). The
  Scholar row and PDF box classes, PubMed's `.docsum-citation`, the arXiv abstract's DOI link and
  MDPI's DOI link are written from their documented markup, not observed live in this build. If
  one differs, that page's button falls back (after the byline, under the title) or is absent —
  it never saves a different paper. First check after merging: load the unpacked add-on and open
  one page of each kind.
- The e2e spec has not been run; nor `scripts/store-assets.mjs` (no new store pictures).
- A button on every article page (would need `<all_urls>` or an opt-in optional permission) —
  the toolbar button covers those pages.
- Scholar country domains other than .com and .co.in; MDPI listings (deliberately none).
- Publishing 0.3.0: the owner's, after 0.2.1 is approved (`apps/extension/PUBLISHING.md` §7).
