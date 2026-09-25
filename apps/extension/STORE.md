# Chrome Web Store listing — drafted for the owner to submit

The agent cannot create the developer account, pay its registration fee or submit the listing;
everything below is ready to paste. Review it — it is your product's public description.

## The package

```bash
pnpm --filter @tc/extension build
```

Then zip the **contents** of `apps/extension/dist` (not the folder itself). On Windows:
`Compress-Archive -Path apps/extension/dist/* -DestinationPath thesis-copilot-extension-0.1.0.zip`.
Upload that zip in the developer dashboard.

## Store listing

**Name:** Thesis Copilot

**Summary (132 characters max):**
Add the paper you are reading to your Thesis Copilot library in one click.

**Description:**

> Reading a paper you want to cite? Click the Thesis Copilot button and it goes straight into your
> thesis library — looked up, its free full text fetched when there is one, and ready to cite and
> to chat with.
>
> • Works on journal article pages, PubMed and arXiv: it reads the paper's DOI and details the way
>   Google Scholar does.
> • Pick which thesis it goes into; the add-on remembers your last choice.
> • It will not add the same paper twice.
> • Uses your existing Thesis Copilot sign-in — nothing new to set up.
>
> Privacy: the add-on looks at a page only when you click its button, and then only at the page's
> address and the tags that describe the article. It never reads the page's text, other tabs or
> your browsing history.
>
> You need a Thesis Copilot account: https://thesis.rademics.ai

**Category:** Education
**Language:** English

**Screenshots (1280×800):** the add-on over an article page, showing the paper and "Add to
library"; and the confirmation. The browser test saves a small version of the popup at
`apps/web/test-results/extension-added.png`; the store wants full-size screenshots taken in a
real Chrome window.

**Icon:** `apps/extension/static/icons/icon-128.png`

## Privacy practices tab

**Single purpose:** Save the scholarly article the user is viewing to their Thesis Copilot
library.

**Permission justifications:**

- `activeTab` — to read the article's identifiers (DOI, title, authors) from the tab the user
  clicked the button on, and only then.
- `scripting` — to run the one function that reads those identifiers in that tab.
- `storage` — to remember which of the user's theses they added to last.
- Host permission `https://thesis.rademics.ai/*` — to list the user's theses and add the article
  to the one they choose, on the user's own Thesis Copilot account.

**Remote code:** No. All code is in the package.

**Data usage** (what the form calls data "collected"): **Website content** — the article's title,
authors, journal, year and DOI from the page the user clicked on, sent to the user's own Thesis
Copilot library when they choose "Add to library". Nothing else is collected. Tick the three
certifications: not sold to third parties, not used for unrelated purposes, not used for
creditworthiness or lending.

**Privacy policy URL:** https://thesis.rademics.ai/privacy (it has a section on the add-on from
the release after 2026-09-25).
