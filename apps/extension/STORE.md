# Chrome Web Store listing — drafted for the owner to submit (version 0.3.2)

0.3.2 (2026-10-10, ADR-0154) replaces 0.3.1 before either is submitted: the same install-time
permissions, plus one **optional** host permission (`https://*/*`) that is asked for only when the
user turns on "Show Save buttons on every site" in the add-on's window. The install warning does
not change. Submit `thesis-copilot-chrome-0.3.2.zip` wherever this file or `PUBLISHING.md` says
0.3.1 or 0.3.0. What changed from 0.3.1 is marked **(new in 0.3.2)** below. The privacy page's
"From version 0.3.2…" paragraph must be live before 0.3.2 is submitted.

0.3.1 (2026-10-10, ADR-0153) replaces 0.3.0 before either is submitted: the same permissions, plus
buttons on MDPI search results and a local note of the papers the buttons saved (the `storage`
box below says so). Submit `thesis-copilot-chrome-0.3.1.zip` wherever this file or `PUBLISHING.md`
says 0.3.0.

0.3.0 adds the in-page buttons (ADR-0125) and with them one new permission: a content script on
five sites. Submit it only after 0.2.1's review is approved, as an update to the same item
(`PUBLISHING.md` §7). What changed from 0.2.1's listing is marked **(new in 0.3.0)** below.

The agent cannot create the developer account, pay its registration fee or submit the listing;
everything below is ready to paste. `PUBLISHING.md` walks through the dashboard, form by form.
Review the wording — it is your product's public description.

## The package

```bash
pnpm --filter @tc/extension build
```

This writes `apps/extension/dist/` and **`apps/extension/thesis-copilot-chrome-0.3.2.zip`** — the
contents of `dist/` and nothing else. Upload that zip. (It is not committed; build it fresh.)

## Store listing tab

**Name:** Thesis Copilot

**Summary** (132 characters max — this is 115; it is also the manifest's description, so the store
fills it in from the zip) **(new in 0.3.0)**:

> Save the papers you read to your Thesis Copilot library — from a button on the page, a page of results, or the PDF.

**Description:**

> Reading a paper you want to cite? Click Thesis Copilot and it goes straight into your thesis
> library — looked up, its free full text fetched where there is one, and ready to cite, read and
> chat with. Then open it in Thesis Copilot in one more click.
>
> • Right on the page: on Google Scholar, PubMed, arXiv and MDPI, press "Add to Thesis Copilot" on
>   any result or beside the article's DOI. A small card shows the paper as Thesis Copilot finds
>   it — with "Cited by", open access and "PDF found" when they are known — and saves it in one
>   more click.
> • Journal article pages, PubMed and arXiv: it reads the paper's DOI and details the way Google
>   Scholar does.
> • A page of results: on PubMed, arXiv and Google Scholar results, tick the papers you want and
>   save up to 50 at once. Each one is saved once; you see which were saved, which were already
>   in your library, and retry any that failed.
> • Several at once on the page: on a results page or a reference list, "Select several" in the
>   card, tick the ones you want, and save them in one go — each one says whether it was saved,
>   was already in your library, or why it was not.
> • Anywhere, if you want it: switch on "Show Save buttons on every site" and article pages on
>   any site get the button, and each DOI in a reference list (a Wikipedia article's, say) a small
>   "Save". Off until you turn it on; Chrome asks you first.
> • A PDF open in your browser: attach it, so the paper can be read straight away.
> • Choose the thesis and, if you like, a collection — or make a new collection on the spot. The
>   add-on remembers your last choice.
> • Right-click a DOI or arXiv link: "Add to Thesis Copilot".
> • Keyboard: Alt+Shift+S opens it (change it at chrome://extensions/shortcuts).
> • Light and dark, following your system.
> • Uses your existing Thesis Copilot sign-in — nothing new to set up, no password stored.
>
> Privacy: on most sites the add-on looks at a page only when you click its button (or choose it
> from the right-click menu), and then only at the page's address, the tags that describe the
> article, and on a results page the titles and identifiers of the results shown. On Google
> Scholar, PubMed, arXiv and MDPI it reads the same things as the page loads, to put its buttons
> in, and sends nothing until you press one. If you switch on "Show Save buttons on every site",
> it reads those same things on every page you open, for the same purpose, until you switch it
> off. It never reads other tabs or your browsing history,
> never contacts those sites itself, and sends nothing anywhere but your own Thesis Copilot
> account.
>
> You need a Thesis Copilot account: https://thesis.rademics.ai

**Category:** Education
**Language:** English

**Store icon (128×128):** `apps/extension/static/icons/icon-128.png` (96×96 artwork inside 16 px of
transparent padding, as the store asks).

**Screenshots (1280×800, upload both, in this order):**

1. `apps/extension/store/screenshot-1-save-a-paper.png` — the add-on over an article page, the
   paper saved, "Open in Thesis Copilot".
2. `apps/extension/store/screenshot-2-save-results.png` — saving a page of results.

0.3.0 has no picture of the in-page button or card yet: `scripts/store-assets.mjs` draws the popup
only. The two pictures above are still true of 0.3.0 and are enough for the update.

**Small promotional tile (440×280):** `apps/extension/store/promo-small-440x280.png`

Every journal, paper and person in the pictures is invented (the DOIs use Crossref's test prefix
10.5555); they show no browser tab bar, address bar or personal data. `node scripts/store-assets.mjs`
redraws them after a design change.

**Official URL / homepage:** https://thesis.rademics.ai
**Support URL:** https://thesis.rademics.ai (or the support address you use)

## Privacy practices tab

**Single purpose** (paste as is):

> Save scholarly papers the user is viewing — the article on the page, results the user ticks on a
> search results page or picks with a button beside them, or the PDF open in the tab — to the
> user's own Thesis Copilot library.

**Permission justifications** (one box each; the dashboard shows the content script's sites under
host permissions):

- **`activeTab`** — When the user clicks the button (or uses its shortcut), the add-on reads the
  article's identifiers (DOI, title, authors, journal, year) from that one tab, and on a PubMed,
  arXiv or Google Scholar results page the titles and identifiers of the results shown. It is also
  what lets the add-on download the PDF open in that tab when the user chooses "Attach this PDF".
  Nothing is read from any other tab, or without the click.
- **`scripting`** — To run the one function that collects those identifiers in the tab the user
  clicked on. Apart from the content script on the five sites below, no script runs on any page
  otherwise.
- **`storage`** — To remember which of the user's theses, and which collection, they saved to
  last; for at most two minutes and in memory only, a link the user right-clicked, so the
  window that opens can show that paper; and (new in 0.3.1), on the user's computer only, the
  identifiers (DOI, arXiv id or PubMed id) of the papers the in-page buttons saved, so a button on
  a page the user comes back to says "Saved to Thesis Copilot". That list is never sent anywhere.
- **`contextMenus`** — To add "Add to Thesis Copilot" to the right-click menu of links that point at
  a paper (a DOI link, a publisher's /doi/ page or an arXiv abstract or PDF). It appears on no other
  links.
- **Host permission `https://thesis.rademics.ai/*`** — The add-on's own service: to list the user's
  theses and collections and save papers into the one they choose, on the user's own account, with
  the sign-in they already have on that site.
- **Content script on `scholar.google.com/scholar*`, `scholar.google.co.in/scholar*`,
  `pubmed.ncbi.nlm.nih.gov`, `arxiv.org/abs|list|search` and `www.mdpi.com`** **(new in 0.3.0)** —
  To put an "Add to Thesis Copilot" button beside each search result and beside an article's DOI
  on these scholarly sites, the ones students search most. The script reads only the tags that
  describe the article and, on a results page, each result's title, authors and identifier, as the
  page shows them. It makes no request to these sites and sends nothing until the user presses a
  button; then it sends the paper's identifier (DOI, arXiv id or PubMed id) to the user's own
  Thesis Copilot account. It runs on no other site; elsewhere the user clicks the toolbar button.

- **Optional host permission `https://*/*`** **(new in 0.3.2)** — Not granted at install, and
  never requested on its own. It is requested only when the user turns on "Show Save buttons on
  every site" in the add-on's window, with Chrome's own prompt; turning the switch off removes it
  (`chrome.permissions.remove`). While the user has granted it, the add-on registers its content
  script (the same one the five sites above have) on https pages, in the top frame only, to put a
  "Save" button beside a scholarly article's DOI (read from the page's `citation_doi`,
  `dc.identifier` or `prism.doi` tags, or its `citation_title` tag) and beside each DOI link in
  the page's reference list. It reads only those tags and links, makes no request to the site,
  and sends nothing until the user presses a button; then it sends that paper's DOI or details
  (or, for several ticked at once, theirs) to the user's own Thesis Copilot account. Students
  read papers on thousands of publishers' and reference sites, so no list of hosts could cover
  them; the switch keeps it the user's choice.

Paste the content-script box into the host-permission justification as well if the dashboard has
only one box for hosts. If the dashboard lists a permission or a site not named here, stop: the
build is not the one described here.

**Remote code:** No, I am not using remote code. (All code is in the package; the manifest's
content security policy is `script-src 'self'`.)

**Data usage — what the add-on handles** (tick these, and only these):

- **Website content** — the article's title, authors, journal, year and DOI from the page the user
  clicked on; on a results page, the titles and identifiers of the results the user ticks; and,
  when the user chooses "Attach this PDF", the PDF file open in the tab. From an in-page button
  (new in 0.3.0), the paper's identifier — or, for a search result that has none, its title,
  authors and year as shown. Sent only to the user's own Thesis Copilot library, only when the user
  chooses it.
- **Authentication information** — no. The add-on stores no token or password; the browser sends
  the site's own session cookie to the site.
- Personally identifiable information, health, financial, personal communications, location, web
  history, user activity — **no**.

Tick the three certifications: the data is not sold or transferred to third parties (outside the
approved use), not used or transferred for purposes unrelated to the item's single purpose, and not
used or transferred to determine creditworthiness or for lending.

**Privacy policy URL:** https://thesis.rademics.ai/privacy (its section "The Chrome add-on" covers
version 0.2.0 — results pages and the PDF — and, from the site release carrying ADR-0125, the
0.3.0 in-page buttons. That release must be live before 0.3.0 is submitted).

## Distribution tab

**Visibility:** Public (anyone can find it) or Unlisted (only people with the link). Unlisted is a
good first step: share the link with a few students, then switch to Public — no new review is
needed for the visibility change.
**Regions:** All regions (or India only, if that is the market).
**Pricing:** Free.
