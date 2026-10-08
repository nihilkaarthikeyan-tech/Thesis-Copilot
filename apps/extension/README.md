# Thesis Copilot for Chrome

Saves the papers a student reads into a thesis library: the article on the page, the ticked
results of a PubMed, arXiv or Google Scholar results page, or the PDF in the tab — then opens the
paper in Thesis Copilot. Since 0.3.0 it also puts an "Add to Thesis Copilot" button into Google
Scholar, PubMed, arXiv and MDPI pages. ADR-0031 has the first design, ADR-0069 version 2, ADR-0125
the in-page buttons; `STORE.md` has everything the Chrome Web Store asks for; `PUBLISHING.md` is
the step-by-step for publishing; `CHANGELOG.md` the versions.

## Try it

1. `pnpm --filter @tc/extension build` — writes `dist/` (pointed at https://thesis.rademics.ai) and
   `thesis-copilot-chrome-<version>.zip` for the store. `build:dev` writes `dist-dev/`, pointed at
   the dev stack on localhost; `--api`/`--web` point a development build elsewhere.
2. Chrome → `chrome://extensions` → switch on **Developer mode** → **Load unpacked** → pick
   `apps/extension/dist`.
3. Sign in at thesis.rademics.ai in the same Chrome.
4. Open an article page, a PubMed/arXiv/Scholar results page or a paper's PDF, and click the icon
   (or press Alt+Shift+S). Or right-click a DOI or arXiv link → "Add to Thesis Copilot".
5. On Google Scholar (.com, .co.in), PubMed, arXiv (abstracts, listings, searches) and MDPI
   articles, press the "Add to Thesis Copilot" button in the page itself.

## What it does, and does not

- Reads the tab only when the student clicks (`activeTab`): the address, the `<meta>` tags
  publishers write for Google Scholar, and on a results page the titles and identifiers of the
  results shown. Never other tabs or history; never requests Google Scholar itself.
- On the five sites in `src/hosts.ts` only, a content script reads the same tags and results as
  the page loads, to put the buttons in (ADR-0125). It makes no request to the site; a button
  sends Thesis Copilot only the paper's identifier (`lookup-id`, `import-id`), or, for a Scholar
  result with none, the reference line the popup sends. A page whose tags name no article gets no
  button.
- Uses the student's existing sign-in to the site. It has no password, token or account of its own.
- Saves through the library's own routes — `POST /documents/:id/sources/resolve` (lookup, full-text
  fetch, indexing and monthly limits are the site's), `POST /sources/:id/upload` and
  `POST /documents/:id/sources/upload` for a PDF, `POST /collections/:id/sources` for a collection.
- Remembers the last thesis and collection (`chrome.storage.local`); a right-clicked link waits in
  memory (`chrome.storage.session`) for at most two minutes. Nothing else is stored.

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
| `src/content.ts` | The content script: starts `inpage.ts`, passes its requests to the service worker |
| `scripts/build.mjs` | TypeScript → `dist/`, `content.js` (esbuild, not minified), the manifest, the per-target `config.js`, the store zip |
| `scripts/icons.mjs` | Draws `static/icons/icon.svg` (the LogoMark) as the PNG sizes; the PNGs are committed |
| `scripts/store-assets.mjs` | Pictures of every popup state (`store/states/`), the store screenshots and promo tile |

Unit tests: `pnpm --filter @tc/extension test`. The browser test is `apps/web/e2e/extension.spec.ts`:
it loads the add-on into Chromium and saves an article, a results page and a PDF against a running
API (`NEXT_PUBLIC_API_URL`). `apps/web/e2e/extension-inpage.spec.ts` does the same for the in-page
buttons, with the four sites answered from `test/fixtures/` (a `--open-shadow` development build).
