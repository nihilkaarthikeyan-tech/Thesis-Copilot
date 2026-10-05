# ADR-0031 — A Chrome add-on that adds the paper on the page to a thesis library

**Date:** 2026-09-25
**Status:** Accepted; extended by ADR-0069 (version 0.2.0: open the saved paper, collections,
results pages, PDFs, shortcut, right-click, the product's look)
**Reverses:** the "not planned" note in `docs/PENDING.md` (a browser extension is "a separate
product with its own store review"). The owner's manager set the bar as matching Jenni.ai, and
the add-on was the last item on Jenni's feature list this product lacked that is code rather than
content.

## What it is

`apps/extension`: a Manifest V3 Chrome extension. On a journal article page, PubMed or arXiv, the
student clicks the icon; a small window shows the paper, a list of their theses and **Add to
library**; the paper joins that thesis's library.

## The decisions

- **It reads a page only when clicked.** `activeTab` + `scripting`, no content script, no host
  permission on the web at large. It reads the address and the `<meta>` tags publishers write for
  Google Scholar (`citation_doi`, `citation_title`, `citation_author`…), never the page text — a
  reference list is full of other papers' DOIs, and the first one found would be the wrong paper.
  Which tags, in which order, is `src/paper.ts`, pure and unit-tested.
- **No server change, and no login of its own.** An extension may call a host it has permission
  for without CORS, and Chrome sends that host's cookies with the request, so the student's
  session on the site is the add-on's session: signed in there is signed in here, signed out
  there is signed out here. The browser test proves it against the dev stack.
- **It adds through the library's own import route**, `POST /documents/:id/sources/resolve`: the
  same lookup, full-text fetch, indexing and caps as everything else that enters a library.
- **Duplicates are checked by DOI in the add-on.** The route's own check compares the reference
  text, and the same paper added from search is written differently. The add-on reads the library
  first and says "already in the library" rather than adding a second copy. (Doing it in the route
  would help every import; it would also be a server change and a release, which this did not
  need.)
- **The requests are made by the service worker**, because a popup closes when the student clicks
  anywhere else and a request started there would be cut off.
- **arXiv DOIs are written the library's way** (`10.48550/arxiv.<id>`, lower case); a test holds
  the add-on's copy of that rule to `@tc/retrieval`'s.

## Two seams for the browser test, and why production does not have them

A test cannot click Chrome's toolbar, so it cannot grant `activeTab`. The popup therefore accepts
`?tab=<id>` (opened as a page, the tab in front would be the popup itself), and the build takes
`--extra-host` to let the test build read its fixture host without a click. The production build
is made without `--extra-host`, so the shipped add-on can read only a tab the student clicked.

## What it does not do

It does not save the page's PDF (the library's full-text fetch already looks for a free copy), it
does not work in Firefox or Safari (Chrome and Edge only — Edge runs Chrome extensions), and it is
not published: the Chrome Web Store needs a developer account in the owner's name. `STORE.md` has
the listing, the permission justifications and the privacy answers ready to paste.
