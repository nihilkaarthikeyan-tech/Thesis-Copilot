# 0154 — Add-on 0.3.2: buttons on any site (opt-in), several at once, MDPI's PDF on the server

Date: 2026-10-10
Status: accepted (the owner approved all three the same day, from ADR-0153's "Not done").
Builds on ADR-0069, ADR-0125 and ADR-0153, which still hold unless this record says otherwise.

## Context

ADR-0153's side-by-side with Jenni's add-on left three things for a decision: Jenni's buttons run
everywhere (ours on five sites), its panel ticks several results for one press (ours does bulk in
the toolbar popup only), and neither got MDPI's PDF into the library — ours stayed "Abstract only".

## Decision

1. **Save buttons on any site, opt-in.** The manifest gains `optional_host_permissions:
   ["https://*/*"]` and nothing at install, so the install warning is the same as 0.3.1's. The
   popup has a switch, "Show Save buttons on every site": on the student's press it calls
   `chrome.permissions.request` (Chrome's own prompt); off calls `permissions.remove`. The
   service worker keeps a dynamic content script (`chrome.scripting.registerContentScripts`, id
   `tc-anywhere`, the same `content.js`, top frame, `document_idle`) in step with the access on
   every wake and on `permissions.onAdded`/`onRemoved` (`src/anywhere.ts`, `syncAnywhere`), so
   access taken away at chrome://extensions takes the buttons too. It excludes the five sites
   (they have the static script; a page flag also stops a second run), Thesis Copilot's own host
   and `jenni.ai` with its subdomains — and `findSpots` and `content.ts` refuse those hosts again.
   The service worker answers a content script from another site only while the permission is held.
   On such a page the add-on finds: the article its tags name (`citation_doi`, `dc.identifier`,
   `prism.doi` through `paperFrom`, or Highwire's `citation_title` with an author, date or journal
   — `dc.title` alone is too common on blogs), and every doi.org link inside a reference list
   (`ol.references`, `.reflist`, `.ref-list`, `#references`, `.bibliography`, the DPUB-ARIA
   roles…), one per reference, not the page's own DOI, not a hidden one, not one in the body text.
   A reference gets a compact "Save" (inline, after the link; the screen-reader label keeps the
   full words). The five sites behave exactly as in 0.3.1. STORE.md has the justification box and
   the privacy page a paragraph "From version 0.3.2…".
2. **Several at once from the card.** On a page with two or more result or reference buttons the
   card offers "Select several (N)": a list with a checkbox per button (the pressed one ticked
   unless already saved), Select all / Clear, the thesis and collection, and "Save selected (n)"
   (at most `BULK_MAX`, 50). It sends one new content-script request, `save-many` (checked like
   `save-one`: ids, 1–50 papers each passing `checkPaper`), which the service worker runs through
   the popup's `runSave` with the batch size raised to 50 — so the library is read once, DOIs
   already there are "already in your library", and every new reference goes in **one** resolve
   call (the route takes up to 500 and dedupes, ADR-0139). Each row then says "Saved", "Already in
   your library" or "Not saved: <reason>"; the failed stay ticked for "Try again (n)"; saved rows'
   buttons change label and are remembered (`memory.ts`). The pure part is `src/bulk.ts`. No PDF
   is fetched in a bulk save.
3. **MDPI's PDF, server side.** Observed 2026-10-10 from this machine, within minutes: Unpaywall's
   address for an MDPI paper (`www.mdpi.com/…/pdf?version=…`) answered the PDF (200, no
   content-type, `content-disposition: attachment; filename="energies-18-01921.pdf"`), then a bot
   manager's "verify" page (200 text/html, a meta refresh with a `bm-verify` token), then 403. We
   do not answer a bot check (ADR-0101). The file host `mdpi-res.com` served the same file at
   `/d_attachment/<journal>/<journal>-<vol>-<article, 5 digits>/article_deploy/<same>.pdf` as
   `application/pdf` each time. So for a 10.3390 DOI the worker (`index-source`, which
   `fetch-pdfs` re-queues) now tries that address first and Unpaywall's MDPI address second
   (`packages/retrieval/src/scholarly/mdpi.ts`), with three new options on `fetchOpenAccessPdf`:
   `allowHosts` (every hop https on `www.mdpi.com`, `mdpi.com`, `mdpi-res.com`, `www.mdpi-res.com`; a redirect
   elsewhere stops before that host is asked), `requirePdfType` (`application/pdf`, or a typeless
   download named `.pdf`) and `mustContain` (the built address's file must contain the DOI —
   MDPI's PDFs carry it in their "check for updates" link — so a rule-built address can never
   attach another paper). The size cap is the fetcher's 25 MB. The journal folder is the journal's
   name, lower case, letters and digits (Energies → `energies`, Remote Sensing → `remotesensing`,
   both observed); where MDPI's code differs (Applied Sciences is `applsci`) the built address is
   simply not found and Unpaywall's address is tried as before. No table of codes is kept — it
   would be invented data. Nothing is added to the add-on for this.

## Not done

- **A journal whose MDPI code is not its name** (applsci, ijerph, ijms…) still depends on
  MDPI's bot-checked address; many of those are in PubMed Central, which Europe PMC already
  covers (ADR-0054). A code read from somewhere authoritative would close it.
- **Not run from the VPS.** The bot manager's answers depend on the caller; the file host
  answered every request from this machine. The owner's first MDPI save after the release is
  the proof (PENDING).
- **The popup's prompt in a real profile.** Driven with Playwright, the switch reads Chrome's
  state and the registration was proven with the access pre-granted; Chrome's own permission
  prompt cannot be clicked by the tools, so accepting it is the owner's check.

## Evidence

- `apps/extension/test/anywhere.spec.ts` (25): the permission and registration (`syncAnywhere`
  against a fake Chrome: registers once granted, unregisters when removed, nothing otherwise), the
  excludes, who the service worker answers with the switch on; a hand-written structural fixture
  in Wikipedia's reference markup (`test/fixtures/wikipedia-references.html`, invented 10.5555
  DOIs) — three buttons, one per reference, none in the body, hidden or DOI-less; `citation_doi`,
  `dc.identifier`, `prism.doi` and Highwire pages; nothing on our site or Jenni's; `bulk.ts`;
  `checkSaveManyJob`; `saveMany` making one resolve call for 13 new of 14; the card's flow on the
  Wikipedia fixture and on the PubMed results fixture. The extension's 158 tests pass, with
  typecheck, build and Biome.
- `packages/retrieval/test/mdpi.spec.ts` (12): the addresses, `saysPdf`, and the answers observed
  on 2026-10-10 written down as a recorded chain (file host 200 PDF; MDPI's address 200 typeless
  PDF, the "verify" page and 403 — the meta refresh not followed); a redirect staying on MDPI's
  hosts followed, one leaving them or to http stopped before it is asked (a chain in the
  described shape, not an observed one, and marked so); the DOI check; the size cap.
  `apps/worker/test/index-source.spec.ts` (+4): the file host first, MDPI's address on a 404,
  a built address's file without the DOI refused, and the failure reported with no other host
  asked.
- Real Chromium (Playwright, the unpacked build with the access pre-granted, the fixture served
  for an https Wikipedia address, an API stubbed): `tc-anywhere` registered for `https://*/*`
  with 11 excludes; three "Save" buttons, no sideways scroll at 1280 or 390 px; none on a
  jenni.ai address; "Select several" saved two of three ticked in one resolve call of 3 and showed
  "2 saved · 1 not saved" with the reason on the row. The production build: the access not held
  at install, nothing registered, the switch off.
