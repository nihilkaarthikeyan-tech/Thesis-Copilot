# Changelog — Thesis Copilot for Chrome

## 0.3.0 — 2026-10-08 (ADR-0125) — not yet submitted to the store

- **"Add to Thesis Copilot" inside the page**, with no toolbar step: on every Google Scholar
  result (scholar.google.com and .co.in), on PubMed results and article pages, on arXiv abstract
  pages, listings and searches, and beside the DOI on MDPI articles.
- **A card** at the top right: the paper as Thesis Copilot finds it for the page's DOI, arXiv id or
  PubMed id; "Cited by" (Google Scholar's count on a Scholar result, Crossref's elsewhere), open
  access (arXiv, PubMed Central) and "PDF found on this page" — each only when it is known; the
  thesis and collection; Save; then "Open in Thesis Copilot". Escape closes it.
- **The right paper, every time**: a button is tied to an identifier the page itself states; a
  page that names no article (an MDPI issue's contents) gets no button.
- **Saved by its identifier** through the library's paste-an-ID import, so a PubMed record with
  no DOI now goes in by its PMID; already-saved papers say so. Every failure gives its reason.
- **New permission**: the content script on those five sites (Chrome asks existing users to
  accept it). Every other article page keeps the toolbar button.
- API: the identifier lookup also answers `citedBy` and `openAccessVia`.

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
