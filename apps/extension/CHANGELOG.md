# Changelog — Thesis Copilot for Chrome

## 0.2.1 — 2026-10-06

Found by using the add-on on eighteen live sites against Jenni's own list of what its extension
does (`apps/web/e2e/_measure/extension-parity.spec.ts`).

- **A PDF whose address carries its DOI** (`…/article/file?id=10.1371/…`, `?doi=10.…`) is now
  saved as that paper, with its details, not as "file.pdf".
- **A robot check** (reCAPTCHA, "Client Challenge", "Just a moment…") is named as one: finish the
  check on the page, then click again — instead of "No paper on this page".
- The Google Scholar note no longer reads "matched surely".

## 0.2.0 — 2026-10-05 (ADR-0069)

- **Open in Thesis Copilot** after saving: the paper opens in the reader. "Already in the library"
  opens the existing entry.
- **Collections:** choose one while saving, or make a new one on the spot.
- **Results pages:** PubMed, arXiv and Google Scholar results list their papers with checkboxes;
  save up to 50 at once, with progress, per-paper Saved / In library / Failed and "Retry failed".
- **PDF tabs:** attach the PDF to the paper, or save the PDF itself when nothing else names the
  paper. If the site will not hand the file over, the add-on says so and saves the paper by DOI.
- **Keyboard shortcut** Alt+Shift+S, shown in the footer (change it at
  `chrome://extensions/shortcuts`).
- **Right-click** a DOI or arXiv link → "Add to Thesis Copilot".
- **Design:** the product's own logo, colours and type (Satoshi, bundled), light and dark, visible
  focus, every state worded.
- **Security:** a stated content security policy; every value from a page checked before it is
  sent; ids checked before they reach a request; no new host permissions.
- Needs Chrome 127 or later.
- API: `POST /documents/:id/sources/resolve` now also answers `sourceIds`.

## 0.1.0 — 2026-09-25 (ADR-0031)

- First version: the paper on an article page, PubMed or arXiv into a chosen thesis's library, once.
