# ADR-0060 — Chat beyond the library, from search abstracts, through the existing A.4 prompt

**Date:** 2026-10-04
**Status:** Accepted
**Builds on:** ADR-0059 rows 39–41 (the decision to build this without a new prompt), ADR-0016
(the web scope returns candidate sources, never prose), ADR-0020 (the indexes it searches),
PRD FR-4.9 and Appendix A.4 (chat), §10.2 (cap check before any provider call), §10.6
(grounding), the relevance floor (`RELEVANCE_FLOOR`, `@tc/retrieval`).

## What prompted it

`docs/research/coverage-map.md` rows 39–41: Jenni's chat can answer from the web, asks before it
searches, and shows its steps while it works. Ours answered from the library only; a question the
library had nothing on was refused, and "Find papers" (ADR-0016) returned a list of papers but no
answer. ADR-0059 decided to build it **without a new prompt**: the existing scholarly search,
the abstracts it returns as the passages, and the existing A.4 chat prompt — so grounding holds
exactly as it does today.

## Decisions

1. **A third chat scope, `beyond`, not a new endpoint.** `POST /chat` with `scope: 'beyond'`
   streams over the same SSE. The question goes to `WebScopeService.search` — the same search
   `POST /chat/web` runs (OpenAlex, Semantic Scholar when keyed, PubMed, arXiv; no model) — asked
   for 20 candidates instead of 8, so that eight with abstracts usually survive.

2. **Only an abstract the index returned is a passage** (`passagesFromWebResults`,
   `apps/api/src/modules/assist/beyond-library.ts`). A record with no abstract, or one shorter than
   80 characters ("Abstract not available."), is skipped; nothing is written in its place. The
   OpenAlex abstract is the one `@tc/retrieval` rebuilds from its inverted index — the index's
   own words in its own order. At most eight (A.4's own top-K), in the search's order, each cut at
   a sentence end under 1,800 characters. Ids are `Sweb<n>#cabstract`: namespaced away from
   library chunk ids, and still in the shape `normalizeBareCitations` rescues.

3. **The answer is the existing A.4 builder** (`buildChatRequest`) with those passages, and
   `postProcessChat` with their ids: a citation of anything else is stripped and counted as
   `HALLUCINATED_CITE`, unchanged. `packages/ai/prompts/chat.md` is not touched. Two of A.4's
   scripted replies speak of "your library"; the "not enough" one is recognised and replaced by
   the server with a reply about the search (`BEYOND_NOT_ENOUGH_REPLY`), as the panel already
   treats it as a state. The prompt's opening line still says "from their library"; the abstracts
   are what the model is shown, and the grounding is enforced in code, not by that line.

4. **The label is the start of the title and the year** ("Barriers to rooftop solar adoption…,
   2022"). A search result carries no authors (`DiscoveredWork` has none), and inventing a
   surname would be asserting a fact the code has not observed.

5. **Every citation is a paper, marked in or not in the library**, carrying exactly what
   `POST /documents/:id/sources/resolve` takes. Its `sourceId` is empty — the same convention the
   document scope uses for "not citable" — so it cannot be opened as a passage, and the panel
   hides "Add to document" on such an answer. Add goes through the ordinary resolve path; once
   the paper is fetched and read it is a library source, and the same question on Library cites
   it. Nothing from the abstracts enters the thesis without that.

6. **The setting** `User.settings.searchBeyondLibrary`: `off` | `ask` | `on`, **default `ask`**.
   - *Ask first*: a library question refused by the relevance floor (the off-topic refusal only —
     not "your filters removed everything" or "the papers you named have no text", whose fix is on
     the same screen) comes back with `offerBeyond: true`, and the panel shows one button,
     "Search beyond your library for this?".
   - *On*: the same refusal continues straight into the search, inside the same request.
   - *Off*: never offered; `scope: 'beyond'` is refused with 403 before the unit is taken.

7. **One CHAT unit a question, taken before any provider call** (`UsageService.consume`, §10.2),
   refunded when the search returns nothing with an abstract (the relevance floor's refund) and
   when the search or the model call fails. Under *On*, the unit taken for the library question is
   the one the search answer uses — the refusal is not charged and then the answer again.

8. **The steps** are SSE `step` events: "Searching OpenAlex, Semantic Scholar, PubMed, arXiv…"
   (only the indexes actually asked are named), "Reading N abstracts", "Writing the answer". The
   line under the answer: "From the abstracts of 8 papers not in your library — add the ones you
   use." (worded for the cases where some are already in the library).

9. **The student's chat filters apply where a search result can answer them**: year range, minimum
   citations, exclude preprints. Journal citedness is not on a search result, so that filter is
   neither applied nor sent to the prompt (which would otherwise claim it was respected).

## Cost

One fast-tier chat call at most per question, as any question. Computed from the builder, not
guessed (`apps/api/test/chat-beyond.spec.ts`, "cost"): eight abstracts at the 1,800-character cap
and a typical question give a user message of **3,802 tokens** (`approxTokens`, 4 chars a token);
eight 350-token library chunks give 3,098. Both are inside the 4,000 input tokens
`ACTION_PROFILES.CHAT` prices a question at, and the test fails if the worst case (a 2,000-character
question) ever is not. Typical abstracts (150–300 words) are shorter than the cap. The search
itself costs nothing (no model). `docs/COSTING.md` is unchanged: ₹0.0296 a question, same caps.

## What it does not do

- It does not make an abstract a source. The answer is about papers the student has not added;
  it is labelled as such in the answer, under it, and on every citation.
- It is not Jenni's agent that plans, searches several times and verifies. One search, one call.
- The prompt is not re-evaluated for abstracts as passages (ADR-0038's eval set is library
  passages). `docs/PENDING.md` lists a real-model check.
