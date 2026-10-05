# Chrome Web Store listing — drafted for the owner to submit (version 0.2.0)

The agent cannot create the developer account, pay its registration fee or submit the listing;
everything below is ready to paste. `PUBLISHING.md` walks through the dashboard, form by form.
Review the wording — it is your product's public description.

## The package

```bash
pnpm --filter @tc/extension build
```

This writes `apps/extension/dist/` and **`apps/extension/thesis-copilot-chrome-0.2.0.zip`** — the
contents of `dist/` and nothing else. Upload that zip. (It is not committed; build it fresh.)

## Store listing tab

**Name:** Thesis Copilot

**Summary** (132 characters max — this is 95; it is also the manifest's description, so the store
fills it in from the zip):

> Save the papers you read — one, a page of results, or the PDF — to your Thesis Copilot library.

**Description:**

> Reading a paper you want to cite? Click Thesis Copilot and it goes straight into your thesis
> library — looked up, its free full text fetched where there is one, and ready to cite, read and
> chat with. Then open it in Thesis Copilot in one more click.
>
> • Journal article pages, PubMed and arXiv: it reads the paper's DOI and details the way Google
>   Scholar does.
> • A page of results: on PubMed, arXiv and Google Scholar results, tick the papers you want and
>   save up to 50 at once. Each one is saved once; you see which were saved, which were already
>   in your library, and retry any that failed.
> • A PDF open in your browser: attach it, so the paper can be read straight away.
> • Choose the thesis and, if you like, a collection — or make a new collection on the spot. The
>   add-on remembers your last choice.
> • Right-click a DOI or arXiv link: "Add to Thesis Copilot".
> • Keyboard: Alt+Shift+S opens it (change it at chrome://extensions/shortcuts).
> • Light and dark, following your system.
> • Uses your existing Thesis Copilot sign-in — nothing new to set up, no password stored.
>
> Privacy: the add-on looks at a page only when you click its button (or choose it from the
> right-click menu), and then only at the page's address, the tags that describe the article, and
> on a results page the titles and identifiers of the results shown. It never reads other tabs or
> your browsing history, and it sends nothing anywhere but your own Thesis Copilot account.
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

**Small promotional tile (440×280):** `apps/extension/store/promo-small-440x280.png`

Every journal, paper and person in the pictures is invented (the DOIs use Crossref's test prefix
10.5555); they show no browser tab bar, address bar or personal data. `node scripts/store-assets.mjs`
redraws them after a design change.

**Official URL / homepage:** https://thesis.rademics.ai
**Support URL:** https://thesis.rademics.ai (or the support address you use)

## Privacy practices tab

**Single purpose** (paste as is):

> Save scholarly papers the user is viewing — the article on the page, results the user ticks on a
> search results page, or the PDF open in the tab — to the user's own Thesis Copilot library.

**Permission justifications** (one box each):

- **`activeTab`** — When the user clicks the button (or uses its shortcut), the add-on reads the
  article's identifiers (DOI, title, authors, journal, year) from that one tab, and on a PubMed,
  arXiv or Google Scholar results page the titles and identifiers of the results shown. It is also
  what lets the add-on download the PDF open in that tab when the user chooses "Attach this PDF".
  Nothing is read from any other tab, or without the click.
- **`scripting`** — To run the one function that collects those identifiers in the tab the user
  clicked on. No script runs on any page otherwise; the add-on has no content scripts.
- **`storage`** — To remember which of the user's theses, and which collection, they saved to
  last; and, for at most two minutes and in memory only, a link the user right-clicked, so the
  window that opens can show that paper.
- **`contextMenus`** — To add "Add to Thesis Copilot" to the right-click menu of links that point at
  a paper (a DOI link, a publisher's /doi/ page or an arXiv abstract or PDF). It appears on no other
  links.
- **Host permission `https://thesis.rademics.ai/*`** — The add-on's own service: to list the user's
  theses and collections and save papers into the one they choose, on the user's own account, with
  the sign-in they already have on that site.

**Remote code:** No, I am not using remote code. (All code is in the package; the manifest's
content security policy is `script-src 'self'`.)

**Data usage — what the add-on handles** (tick these, and only these):

- **Website content** — the article's title, authors, journal, year and DOI from the page the user
  clicked on; on a results page, the titles and identifiers of the results the user ticks; and,
  when the user chooses "Attach this PDF", the PDF file open in the tab. Sent only to the user's own
  Thesis Copilot library, only when the user chooses Save.
- **Authentication information** — no. The add-on stores no token or password; the browser sends
  the site's own session cookie to the site.
- Personally identifiable information, health, financial, personal communications, location, web
  history, user activity — **no**.

Tick the three certifications: the data is not sold or transferred to third parties (outside the
approved use), not used or transferred for purposes unrelated to the item's single purpose, and not
used or transferred to determine creditworthiness or for lending.

**Privacy policy URL:** https://thesis.rademics.ai/privacy (its section "The Chrome add-on" covers
version 0.2.0 — results pages and the PDF — from the release that carries this change).

## Distribution tab

**Visibility:** Public (anyone can find it) or Unlisted (only people with the link). Unlisted is a
good first step: share the link with a few students, then switch to Public — no new review is
needed for the visibility change.
**Regions:** All regions (or India only, if that is the market).
**Pricing:** Free.
