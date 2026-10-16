# Thesis Copilot for Chrome

Saves the papers a student reads into a thesis library: the article on the page, the ticked
results of a PubMed, arXiv or Google Scholar results page, or the PDF in the tab — then opens the
paper in Thesis Copilot. It also puts a "Save to Thesis Copilot" button into pages: on Google
Scholar, PubMed, arXiv and MDPI since 0.3.0, and since 0.4.0 beside a paper on any https site.
ADR-0031 has the first design, ADR-0069 version 2, ADR-0125 the in-page buttons, ADR-0156 0.4.0
(buttons everywhere, the simpler window); `STORE.md` has everything the Chrome Web Store asks for; `PUBLISHING.md` is
the step-by-step for publishing; `CHANGELOG.md` the versions.

## Try it

1. `pnpm --filter @tc/extension build` — writes `dist/` (pointed at https://thesis.rademics.ai) and
   `thesis-copilot-chrome-<version>.zip` for the store. `build:dev` writes `dist-dev/`, pointed at
   the dev stack on localhost; `--api`/`--web` point a development build elsewhere.
2. Chrome → `chrome://extensions` → switch on **Developer mode** → **Load unpacked** → pick
   `apps/extension/dist`.
3. Sign in at thesis.rademics.ai in the same Chrome.
4. Open an article page, a PubMed/arXiv/Scholar results page or a paper's PDF, and click the icon
   (or press Alt+Shift+S). Or right-click a DOI or arXiv link → "Save to Thesis Copilot".
5. Press "Save to Thesis Copilot" in the page itself: on Google Scholar (.com, .co.in), PubMed,
   arXiv and MDPI results and articles, and (since 0.4.0, with nothing switched on) beside an
   article on any https site and a small **Save** beside each DOI in a reference list (a
   Wikipedia article's references, say). On a page with several, the card has **Select
   several**: tick them and **Save selected (n)**.
6. The gear in the add-on's window opens **Settings**: theme, **Save buttons in pages** (on all
   sites, and "This site"), the keyboard shortcut and the version. Turning the buttons off takes
   them out of open pages at once.
7. `node scripts/review.mjs` draws every window state and the buttons on four sites in real
   Chromium (fixtures, a local API stand-in) into `docs/design/extension-0.4/`, with the
   fresh-install check and the review PDF.

## What it does, and does not

- Reads the tab only when the student clicks (`activeTab`): the address, the `<meta>` tags
  publishers write for Google Scholar, and on a results page the titles and identifiers of the
  results shown. Never other tabs or history; never requests Google Scholar itself.
- On the five sites in `src/hosts.ts`, a content script reads the same tags and results as
  the page loads, to put the buttons in (ADR-0125). It makes no request to the site; a button
  sends Thesis Copilot only the paper's identifier (`lookup-id`, `import-id`), or, for a Scholar
  result with none, the reference line the popup sends. A page whose tags name no article gets no
  button.
- Everywhere else since 0.4.0 (ADR-0156, `src/manifest.ts`, `src/anywhere.ts`): the host
  permission `https://*/*` is held from install and a second manifest entry runs the same content
  script on every https page except the five sites and Thesis Copilot itself; it reads the
  article tags (`citation_doi`, `dc.identifier`, `prism.doi`, Highwire's `citation_title`) and the
  doi.org links inside reference lists, and sends nothing until a press. The student turns the
  buttons off for every site or one site in Settings (`src/settings.ts`, `chrome.storage.local`);
  the script then puts nothing in, and takes out what it had.
- "Select several" in the card sends the ticked results in one `save-many` request, which the
  service worker saves the popup's way (duplicates by DOI, then one resolve call with all of
  them) and answers per result.
- Uses the student's existing sign-in to the site. It has no password, token or account of its own.
  The window's account row reads who is signed in from the site's own session route
  (`GET /api/v1/auth/get-session`); sign-out happens on the site.
- Saves through the library's own routes — `POST /documents/:id/sources/resolve` (lookup, full-text
  fetch, indexing and monthly limits are the site's), `POST /sources/:id/upload` and
  `POST /documents/:id/sources/upload` for a PDF, `POST /collections/:id/sources` for a collection.
- Remembers the last thesis and collection (`chrome.storage.local`); a right-clicked link waits in
  memory (`chrome.storage.session`) for at most two minutes. Since 0.3.1 it also keeps, in
  `chrome.storage.local` only, the identifiers of the papers its in-page buttons saved, per thesis
  (`src/memory.ts`, at most 1,000 per thesis), so their buttons say "Saved" on a later visit; that
  list is never sent anywhere. Since 0.4.0, also in `chrome.storage.local`: whether the Save
  buttons are on (all sites, and the sites turned off) and the theme (`src/settings.ts`). Nothing
  else is stored.

## Code

| File | What |
|---|---|
| `src/paper.ts` | Which paper a page or link is about; DOI/arXiv/PMID validation — pure, tested |
| `src/lists.ts` | The papers on a results page, per site — pure, tested against `test/fixtures/` |
| `src/page.ts` | The functions run inside the tab: meta tags, and the results shown |
| `src/state.ts` | The popup's states, as a pure state machine — tested |
| `src/save.ts` | Saving: duplicates by DOI, batches of ten, the collection, the PDF — tested with a fake API |
| `src/api.ts` | The requests to Thesis Copilot and the tab's PDF — tested with a fake `fetch` |
| `src/popup.ts` | Draws the states; everything written with `textContent` |
| `src/background.ts` | The service worker: makes the requests, runs a save, owns the right-click item |
| `src/pending.ts` | The right-clicked link handed to the popup |
| `src/hosts.ts` | The in-page buttons' sites (the content script's `matches`) and who the service worker answers |
| `src/refs.ts` | Which identifier an in-page button saves: the page's own DOI, arXiv id or PMID — pure, tested |
| `src/inpage.ts` | The in-page buttons and their card, in closed shadow roots — tested in jsdom |
| `src/card.ts` | The card's states, as a pure state machine — tested |
| `src/anywhere.ts` | Every site: the matches, what is excluded (the five sites, our own), and removing 0.3.2's registration (ADR-0154, ADR-0156) — tested |
| `src/manifest.ts` | The manifest the build writes: permissions, host permissions, both content-script entries (ADR-0156) — tested |
| `src/settings.ts` | The Save-buttons setting (all sites, per site) and the theme, and a page following them live (ADR-0156) — pure, tested |
| `src/bulk.ts` | "Select several" in the card, as a pure state — tested |
| `src/memory.ts` | Which papers the in-page buttons saved, per thesis, kept in the browser only — pure, tested |
| `src/content.ts` | The content script: starts `inpage.ts`, passes its requests to the service worker |
| `scripts/build.mjs` | TypeScript → `dist/`, `content.js` (esbuild, not minified), the manifest, the per-target `config.js`, the store zip |
| `scripts/icons.mjs` | Draws `static/icons/icon.svg` (the LogoMark) as the PNG sizes; the PNGs are committed |
| `scripts/store-assets.mjs` | Pictures of every popup state (`store/states/`), the store screenshots and promo tile |
| `scripts/review.mjs` | The 0.4.0 review set in real Chromium: popup states, the buttons on four sites, the fresh-install check, the PDF (`docs/design/extension-0.4/`) |

Unit tests: `pnpm --filter @tc/extension test`. The browser test is `apps/web/e2e/extension.spec.ts`:
it loads the add-on into Chromium and saves an article, a results page and a PDF against a running
API (`NEXT_PUBLIC_API_URL`). `apps/web/e2e/extension-inpage.spec.ts` does the same for the in-page
buttons, with the four sites answered from `test/fixtures/` (a `--open-shadow` development build).
