# Thesis Copilot for Chrome

One button on any journal article page: the paper goes into a thesis library. ADR-0031 has the
design; `STORE.md` has everything the Chrome Web Store asks for.

## Try it

1. `pnpm --filter @tc/extension build` — writes `dist/`, pointed at https://thesis.rademics.ai.
   (`build:dev` writes `dist-dev/`, pointed at the dev stack on localhost.)
2. Chrome → `chrome://extensions` → switch on **Developer mode** → **Load unpacked** → pick
   `apps/extension/dist`.
3. Sign in at thesis.rademics.ai in the same Chrome.
4. Open any article page (a journal, PubMed, arXiv) and click the add-on's icon.

## What it does, and does not

- Reads the tab only when the student clicks the icon (`activeTab`): the address and the `<meta>`
  tags publishers write for Google Scholar. Never the page text, other tabs or history.
- Uses the student's existing sign-in to the site. It has no password and no account of its own.
- Adds through `POST /documents/:id/sources/resolve` — the library's own import path, so the
  lookup, full-text fetch, indexing and monthly limits are the site's, unchanged.
- Remembers the last thesis chosen (`chrome.storage.local`). Nothing else is stored.

## Code

| File | What |
|---|---|
| `src/paper.ts` | Which paper a page is about — pure, tested in `test/paper.spec.ts` |
| `src/page.ts` | The function run inside the tab; collects the address, title and meta tags |
| `src/popup.ts` | The window: the paper, the theses, the Add button |
| `src/background.ts` | The service worker that calls the API (a popup's requests die when it closes) |
| `scripts/build.mjs` | TypeScript → `dist/`, the manifest, the per-target `config.js` |
| `scripts/icons.mjs` | Draws `static/icons/icon.svg` as the PNG sizes; the PNGs are committed |

The browser test is `apps/web/e2e/extension.spec.ts`: it loads the add-on into Chromium and adds a
paper from a fixture article page against the dev stack.
