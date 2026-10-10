# Changelog — Thesis Copilot for Chrome

## 0.3.2 — 2026-10-10 (ADR-0154) — not yet submitted to the store

The three things the side-by-side left for a decision, approved by the owner the same day.

- **Save buttons on every site, if you want them.** A switch in the add-on's window, "Show Save
  buttons on every site", off until you turn it on; Chrome asks you first, and turning it off
  gives the access back. While it is on, an article page anywhere gets its button (found by its
  `citation_doi`, `dc.identifier` or `prism.doi` tag, or Highwire's `citation_title`), and every
  DOI in a page's reference list gets a small "Save" beside it — Wikipedia's references, for
  example. Never on Thesis Copilot itself or on Jenni's pages. The install warning is unchanged:
  the access is an optional permission, asked for only on your press.
- **Save several results at once from the page.** On a results page (Google Scholar, PubMed,
  arXiv, MDPI search) or a reference list, the card has "Select several": tick the ones you
  want and "Save selected (n)" saves them into the chosen thesis and collection in one go. Each
  one then says what became of it — saved, already in your library, or not saved and why — and
  the ones not saved stay ticked for another try.
- **MDPI papers get their PDF.** The library now fetches an MDPI paper's open-access PDF from
  MDPI's file host (the add-on asks for nothing new for this; it is the server's fetch).

## 0.3.1 — 2026-10-10 (ADR-0153) — not yet submitted to the store

Found by using it beside Jenni's add-on on the same live pages (Google Scholar, PubMed, arXiv,
MDPI, Springer, ScienceDirect, Wikipedia).

- **The right DOI from a Google Scholar link that carries more than the DOI.** Emerald's
  `…/article/doi/10.1108/IJESM-05-2025-0048/1343209` was read with the article id on the end, so
  the card said "No record found" and saving it again said "Saved" for a paper already in the
  library. The shorter DOI is now looked up next, and a library row under it is "already there".
- **PubMed article: the button sits beside the DOI** in the identifiers line, not beside the
  publisher's logo in the narrow "Full text links" column.
- **The card says when a paper is free to read**, as the page states it: "Free in PubMed
  Central" (PubMed's PMCID link, or "Free PMC article"), "Open access (CC BY 4.0)" from an
  article's licence tag, MDPI's "Open Access" badge.
- **No needless "attach the PDF" step.** For a paper free on arXiv or in PubMed Central the card
  now says its free full text is fetched (the library did so within seconds in every test);
  for any other PDF on the page it names the two ways that work.
- **MDPI search results** have a button on each result, by that result's own DOI (Jenni's add-on
  had them; ours had none). An MDPI issue's contents still get none.
- **Buttons remember what you saved**: a page you come back to shows "Saved to Thesis Copilot" on
  the papers you saved from it into the current thesis. Kept in this browser only, never sent.

## 0.3.0 — 2026-10-08 (ADR-0125) — not yet submitted to the store

- **"Add to Thesis Copilot" inside the page**, with no toolbar step: on every Google Scholar
  result (scholar.google.com and .co.in), on PubMed results and article pages, on arXiv abstract
  pages, listings and searches, and beside the DOI on MDPI articles.
- **A card** at the top right: the paper as Thesis Copilot finds it for the page's DOI, arXiv id or
  PubMed id; "Cited by" (Google Scholar's count on a Scholar result, Crossref's elsewhere), open
  access (arXiv, PubMed Central) and "PDF found on this page" — each only when it is known; the
  thesis and collection; Save; then "Open in Thesis Copilot". Escape closes it. On a window
  narrower than 640 px it is a sheet along the bottom, at most half the window, and the page
  scrolls so the result being saved stays in sight above it; when the page cannot scroll that far
  (the last result on a short page) the sheet goes to the top edge instead (2026-10-09).
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
