# 0153 — The add-on beside Jenni's on the same pages: six fixes (add-on 0.3.1)

Date: 2026-10-10
Status: accepted (the owner asked for the side-by-side and for what is fixable today to be fixed).
Builds on ADR-0069 and ADR-0125, which still hold unless this record says otherwise.

## Context

The owner, with both add-ons installed in their own Chrome, worried that ours "behaves as an
extension but is not comparable to Jenni's". Both were used on the same live pages and the same
papers on 2026-10-10 (search "rooftop solar adoption rural India"): a Google Scholar results
page, a PubMed article, an arXiv abstract and PDF, an MDPI article and MDPI search, a Springer
article (paywalled), a ScienceDirect article (a robot check; not passed) and Wikipedia. The full
record, with screenshots, is `docs/research/EXTENSION-SIDE-BY-SIDE-2026-10-10.md` (kept local,
competitor research stays off GitHub).

In short, Jenni's saved 2 of 4 papers (one of those with no title, authors or DOI — only its
address), failed one with "Save failed" and no reason, and left one on "Processing PDF…" for over
two minutes without it reaching the library; it attached no PDF. Ours saved all four with full
details in about a second each, and two of them (arXiv, PubMed Central) were "Full text" in the
library within seconds. Jenni's did better in breadth: buttons on more places (MDPI search
results, every site that links an MDPI article, the PDF links beside Scholar results), a panel
that lets one button's press tick several results, and buttons that remember a saved paper
("View in Jenni") on the next visit. Ours had five faults of its own, listed below.

## Decision

Six changes, no new permission, no new request to any site:

1. **A DOI read from an address is tried shorter when it has no record** (`doiCandidates`,
   `doiRefs`). Emerald's Scholar link `…/article/doi/10.1108/IJESM-05-2025-0048/1343209` was read
   with the article id on the end; the card said "No record found", the save went in by its text,
   and a second save said "Saved" for a paper already there. Now the DOI as read is looked up
   first, then without a trailing numeric id or view name (`/full`, `/abstract`, …), at most
   three parts; the first with a record wins, and a bulk save finds a library row under the shorter
   DOI as "already there". Nothing is dropped on a guess: with no record for any, the DOI as read
   is kept, as before.
2. **PubMed article: the button goes beside the DOI the page shows as text.** The first link to
   the DOI in PubMed's page is the publisher's logo in the narrow "Full text links" column; the
   button and its "Saved" label overflowed it. `doiLink` now prefers a visible link whose text is
   the DOI, else the first one as before (MDPI, arXiv unchanged).
3. **The card says when a paper is free to read, as the page states it**: PubMed's PMCID link or
   "Free PMC article." → "Free in PubMed Central"; a Creative Commons licence in an article's
   `dc.rights`/`dcterms.license` tags → "Open access (CC BY 4.0)"; MDPI's "Open Access" badge on a
   search result. Never inferred from a publisher's name.
4. **No needless "attach the PDF" step.** For a paper free on arXiv or in PubMed Central the
   saved card says its free full text is fetched (observed: both were "Full text" within seconds);
   for any other PDF on the page it says how to attach it (the toolbar button on the PDF, or "Add a
   PDF" in the library). The old line sent the student off to do what the library had done.
5. **MDPI search results get a button each**, after the result's own DOI link, saving that
   article by that DOI — only on `www.mdpi.com/search`. An issue's contents still get none
   (ADR-0125's rule stands: no page that names no article gets a button for itself, and listings
   other than search were not observed). The popup's results mode reads the same list.
6. **Buttons remember what they saved.** The identifiers (DOI, arXiv id, PMID, or a squashed
   title for a result with none) of each paper an in-page button saved are kept per thesis in
   `chrome.storage.local` (`src/memory.ts`; at most 1,000 per thesis, 20 theses), and a page
   visited again labels those buttons "Saved to Thesis Copilot" for the current thesis. It is
   marked from what this browser did, not by asking Thesis Copilot about the page, so the page
   still sends nothing until a press. The label says what was done, not "In your library": a paper
   removed on the site keeps the label until it is dropped, and pressing it still checks.

`STORE.md` (the `storage` justification), `README.md` and the site's privacy page say what (6)
keeps. The version is 0.3.1; it replaces the unsubmitted 0.3.0 (`STORE.md` heading).

## Not done (needs a decision)

- **One press, many results** (Jenni's panel lists every result with checkboxes). Ours does bulk
  in the toolbar popup only. Doing it in the card is a larger change to the card's state machine.
- **Buttons beyond the five sites** (Jenni's run everywhere, beside any MDPI-like link, which also
  put "Add to Jenni" into our own library page). Needs `<all_urls>` or an opt-in optional host
  permission — a new install warning and store review (ADR-0125 "Not done").
- **The PDF of an open-access paper the library cannot fetch** (MDPI stayed "Abstract only"; its
  PDF redirects to another host, so a content-script fetch is refused by CORS and the service
  worker has no permission there). Either the server's open-access fetcher learns MDPI's PDF
  address, or the add-on asks for that host. Server-side is the cheaper first look.
- **arXiv authors in the library**: the card showed "Kuldeep Kurte, Kedar Kulkarni"; the library
  row showed "Kurte" only — an import-side fault, not the add-on's.
- **Popup and PDF tabs were not driven** in this comparison: the tools cannot click a toolbar
  icon or a native context menu. Both add-ons show nothing inside Chrome's PDF viewer.

## Evidence

`apps/extension/test/sbs-fixes.spec.ts` (16 tests, against two new hand-written structural
fixtures, `pubmed-article-fulltext.html` and `mdpi-search.html`, written to the markup observed
live that day; invented records under 10.5555): the Emerald DOI's candidates and the card's
second lookup, a bulk save's duplicate under the shorter DOI, the PubMed button's place and its
PMC fact, the licence, the PDF line, MDPI search buttons (and none on an issue path), and the
memory's limits, marking and writing. `pnpm --filter @tc/extension test` (133), `typecheck`,
`build` and `biome check apps/extension` pass. Not yet re-run in a real Chrome: the owner reloads
the unpacked `apps/extension/dist` and retests.
