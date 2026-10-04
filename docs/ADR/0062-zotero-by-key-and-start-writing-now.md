# ADR-0062 — Import from Zotero by API key, and "Start writing now"

**Date:** 2026-10-04
**Status:** Accepted
**Builds on:** ADR-0059 rows 36 and 2 (the owner's delegated Jenni decisions), PRD FR-2.9
(bibliography import), FR-1 (the proposal paths), §12.1 (rate limits, no secrets in logs).

## A. Import from Zotero by API key (ADR-0059 row 36)

FR-2.9 says "Zotero/Mendeley import via BibTeX/RIS file upload (not OAuth)". ADR-0059 kept the
"not OAuth" and changed only the transport: the student pastes a key, we read once.

### Decisions

1. **What the student does.** Library tab → **From Zotero** (beside "Import .bib / .ris"). The
   dialog links to `https://www.zotero.org/settings/keys` with one line: make a private key that
   can read the library and nothing more, paste it, and the user ID shown on the same page.
   **Check key** lists the collections; the student picks "The whole library" or one collection
   (nested ones shown as "Parent / Child (n)") and presses **Import**. The result is reported like
   a file import ("Imported 10 of 12 references from Zotero; they are being looked up. 2 were
   already in the library. 1 had no title and no DOI …").

2. **Routes.** `POST /documents/:id/sources/zotero/collections` `{ userId, apiKey }` →
   `{ collections: [{ key, name, parentKey, numItems }], cap }`, and
   `POST /documents/:id/sources/zotero/import` `{ userId, apiKey, collectionKey? }` →
   `{ entries, skipped, notReferences, queued, alreadyPresent }`. POST for both, so the key
   travels in the body (which the Pino logger redacts) and never in a URL (which it logs). Owner
   only, checked **before** Zotero is called (a non-owner gets 404 and no outbound request). Both
   are in the `upload` heavy rate-limit class, like the file import.

3. **What is read from Zotero** (checked against the v3 documentation and the dataserver source;
   the header of `packages/retrieval/src/scholarly/zotero.ts` names each source):
   `GET https://api.zotero.org/users/{id}/items/top` (or `/collections/{key}/items/top`)
   `?format=json&include=data,csljson&itemType=-attachment&limit=100&start=N`, with
   `Zotero-API-Key` and `Zotero-API-Version: 3` headers. `/items/top` leaves out child notes and
   attachments; `itemType=-attachment` leaves out standalone attachments; `data.itemType` lets us
   drop standalone notes and annotations exactly. `csljson` (the CSL item) is mapped to the same
   `BibEntry` the .bib parser produces, using the .bib parser's own `rawLine` and `cleanDoi`, so
   both imports produce identical reference lines. A DOI kept in Zotero's Extra field
   (`DOI: …`) is used when the CSL has none. Paging follows `Link: rel="next"` **only** when it
   points at `https://api.zotero.org` (the key goes with every request), otherwise
   `start`/`Total-Results`.
   `format=csljson` alone was considered and rejected: its `{ items: [...] }` loses `itemType`, so
   a standalone note could not be told from a reference.

4. **Same pipeline.** The entries go to `SourcesService.resolveReferences` — the .bib import's
   dedupe on the reference line and its `resolve-reference` job ids keyed on that line (what the
   job reads). On top, an entry whose DOI is already in the library (normalised: no
   `https://doi.org/`, lower case) counts as already present, because a paper added by search or
   .bib has a different reference line.

5. **The cap.** 500 items per import (`ZOTERO_IMPORT_CAP`). A library or collection whose
   `Total-Results` is over the cap is refused **before anything is added**, with the count and
   "Pick a collection, or import it in parts" — never an arbitrary first 500. If Zotero omitted
   the header, reading past the cap refuses the same way.

6. **The key is never kept.** It lives in the dialog's state until the dialog closes; on the
   server it is passed to the client, sent as a header and dropped. It is not written to any
   table, job payload, log or error. `ZoteroError` builds every message from the HTTP status alone
   and never takes the fetch failure as `cause` (an undici error can carry the request); the
   service redacts the key from anything that reaches it anyway, and any non-Zotero error becomes
   a fixed message. Zod issues are not echoed for these routes.
   `apps/api/test/zotero-import.spec.ts` checks every public table (`row::text LIKE`), every Redis
   value and every console / Nest `Logger` / stdout / stderr write for the key after exercising
   every route, including a network failure whose own message contains the key.

7. **Plain failures.** 403 → 400 `ZOTERO_REFUSED` "Zotero refused that key. Check the user ID
   (the number on the keys page, not your username) and that the key is allowed to read your
   library." 404 → `ZOTERO_NOT_FOUND`. 429 (or 503 with `Retry-After`) → 503 "Zotero asked us to
   slow down…". No answer → 502 "Could not reach Zotero…". Each suggests the .bib export as the
   way round. Every Zotero request has a 20 s time limit.

8. **Mendeley: not built.** It needs an application registered with Elsevier for OAuth; listed in
   `docs/PENDING.md`. The .ris file route still serves Mendeley users.

### Not verified

No real Zotero account or key exists in this project, so no live call has been made. The fixtures
(`packages/retrieval/test/fixtures/zotero.ts`, `apps/api/test/_zotero.ts`) are written from the
documented format and say so in their headers; `docs/PENDING.md` asks for one real import and a
recorded response to replace them.

## B. "Start writing now" (ADR-0059 row 2)

### Decisions

1. **Where.** A secondary button **Start writing now** on the thesis list's new-thesis form
   (beside "Create thesis", with a one-line hint under it) and on `/app/new` (after "Create and
   import from Word", with a one-line explanation). The existing buttons, their wording and where
   they go are unchanged.

2. **What it does.** `POST /documents` as it is — no API change: the title typed, or
   **"Untitled thesis"** when the box is empty (the button does not need the title, which the
   other buttons require); `entryPath: 'A_TOPIC'` whatever radio is ticked, because there is no
   paper to read and the topic path's proposal is the one that can start from the student's own
   words later; the citation style chosen on the form is saved as the other buttons save it. The
   API already creates the first chapter ("Chapter 1"), so the browser goes straight to
   `/app/d/:id/write/:firstChapterId`.

3. **The proposal stays one click away.** `AddProposalPrompt` asks `GET /documents/:id/setup` —
   the setup checklist's own `proposal` step (`hasProposal` = a working title in the proposal) —
   and, for a thesis without one, shows:
   - on the thesis card, beside the path badge: "No proposal yet · **Add a proposal**";
   - in the editor, above the chapter: "This thesis has no proposal yet. It is optional, but
     suggestions stay closer to your topic once it has one. **Add a proposal**" with **Not now**,
     which hides it for that thesis in this browser (`localStorage`, guarded).
   Both link to the step's own `href` (`/app/d/:id/proposal`). Nothing shows while loading, on
   failure (a co-author or reader gets 404 from `/setup` and sees nothing), or once a proposal
   exists. It is shown for any thesis without a proposal, not only those started this way.

## Consequences

- No migration, no new dependency, no model call, no change to cost.
- `cleanDoi` and `rawLine` in `bibliography.ts` are now exported for the Zotero mapper.
