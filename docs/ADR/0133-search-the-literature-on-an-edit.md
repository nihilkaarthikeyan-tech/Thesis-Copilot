# 0133 — "Search the literature" on an AI edit: found papers join the library first

Date: 2026-10-09
Status: accepted (the owner's decision of 2026-10-09; Jenni build plan "next" item 5 / R8 (b);
amends ADR-0095's "Web switch: not built")

## Context

ADR-0095 built the AI edit panel without Jenni's Web switch: passages from the scholarly indexes
behind a rewrite would let an edit cite a paper the student never added, and the library switch
covered grounding. The owner decided on 2026-10-09 to build it in a safe form: the papers a search
finds are **added to the student's library first**, and the edit is then written from the library
as it is today, so every citation the edit makes is to a library paper.

## Decision

**The switch.** The panel (`CommandToolbar.tsx`) gets "Search the literature" beside "Use my
library", both now in a row under the box (they no longer share the box's row, so the box keeps
its width on a phone). Off by default, because it adds papers to the library. Turning it on keeps
"Use my library" on and greys it out: what it finds goes into the library. It applies to the
student's own instruction and to the presets that take passages (Expand, Check consistency,
Counter-argument); the client sends `searchLiterature: true` only for those, never on a follow-up
(the papers are in the library by then), and the server ignores it for any other edit.

**The server** (`EditLiteratureService`, pure rules in `edit-literature.ts`), after the COMMAND
unit is taken (§10.2) and before the edit's call:
1. **Search.** Chat's research search (`WebScopeService.searchPlan`, ADR-0074: OpenAlex semantic
   and keyword, Semantic Scholar with a key, PubMed, arXiv, each within its budget) with the
   instruction and the selection (citation markers and maths removed), the plan made in code by
   `planResearchQueries` with the thesis title. No model. The whole search has a 20 s limit.
2. **Keep the few on topic.** At most 24 candidates with an abstract, not already in the library,
   embedded once (title and the start of the abstract) against the thesis-and-question; kept at
   cosine ≥ 0.60 (chat's measured floor for a found abstract, also `AUTO_SOURCES.addCosine`),
   best first, **at most 5**, one per DOI/title. The embedding has a 15 s limit and is logged as
   `EMBED` so the ₹100 ceiling sees it.
3. **Add them to the library** as `find-sources` adds papers (ADR-0037): a `Source` row with the
   index's title, year, venue, DOI, citation count, preprint flag and abstract, `subTheme` the
   chapter, `autoAddedAt` set (they show "Added automatically" and stay citable under either
   "Library search" setting, ADR-0087), the same `rawReference` chat's Add sends (so a later Add
   finds the row), **filed into the thesis's "Add into" collection** when one is chosen
   (`Document.meta.addInto`, ADR-0129; a deleted collection is dropped quietly), then
   `resolve-reference` → `index-source`, the path every paper takes.
4. **Wait for them to be read**, at most 25 s (abstract-first indexing, ADR-0070, is a few
   seconds); a paper the resolver gives up on stops the wait for itself.
5. **Passages.** The library retrieval of today (by the selection), plus a retrieval restricted to
   the papers just read (by the instruction and the selection); the found papers' best passage
   each goes first, then the library's, no chunk twice, 6 in all (`COMMAND.topK`, unchanged), and
   the keys are given afresh with `byKey` rebuilt (two retrievals both number from `S1#c1`). The
   edit prompt's existing `<passage>` input carries them. **No prompt changed.**

The edit then runs and is post-processed exactly as before: `postProcessCommand` strips any
citation not among the passages sent and counts it `HALLUCINATED_CITE`; a new citation resolves to
a real library row through `byKey`.

**The result** carries `literature: { added, collection, note }`. The panel lists
"Added to your library (in <collection>):" with each paper's short reference opening the reader
(`/app/d/:id/sources/:sourceId`); a paper not read in time says "(still being read)". When the
edit used the library alone, one line says why:
- the search failed or timed out — "The literature search did not answer in time; this edit used
  your library alone.";
- nothing on topic — "The search found nothing close enough to this passage; …";
- papers added but none read in 25 s — "… still being read; … Try again in a minute to cite them."

Nothing enters the thesis until Replace or Insert below, as before (flag, don't fix).

**What it does not do.**
- It does not cite a search result directly. The chat's beyond-library answers do (ADR-0060,
  marked and with Add); an edit writes into the thesis, so only a library paper may be cited.
- It does not read the thesis's start-time source preferences (`readSourcePrefs`: years, listed
  in, preprints, "web search off"). The switch is the student's explicit request for this edit, as
  chat's research is; chat applies its own filters, an edit has none. Revisit if a student turns
  web search off at the start and is surprised the switch still works.
- It does not count against the automatic searches (`SOURCES_FOUND`, ADR-0037): it is inside a
  COMMAND unit the student paid for.
- A failed edit refunds the unit as before, but the papers already added stay in the library
  (marked "Added automatically", removable like any other). They are real records from an index;
  removing them silently would be the surprise.

## Cost

Still **one COMMAND unit**, taken first and atomic; refunded when the edit fails, as today. The
index calls are free. What is new is embedding:
- the relevance call: ≤ 24 candidates × ≤ 1,200 characters ≈ 7,200 tokens, ₹0.039 at most
  (chat research's figure, the same bound);
- reading the papers added: their abstracts, and the full text of any open-access one, through
  `index-source` — the auto-sources bound, ~90k tokens for five papers with full text, under
  ₹0.50 (`AUTO_SOURCES`, `packages/config/src/plans.ts`).

So at most ~₹0.54 an edit with the switch on, × 4 edits a month on a paid plan (2 on the trial) =
**≤ ₹2.16 a month**, all on `voyage-4`, whose first 200M tokens are free (ADR-0032). The edit's
own call is unchanged: still at most 6 passages. The worst case for a fully active student moves
from ₹93.16 to **≤ ₹95.32** at the production configuration, within the ₹100 ceiling; the
runtime hard stop in `UsageService.consume` is unchanged. Recorded in `docs/COSTING.md`.

## Tests

- `apps/api/test/edit-literature.spec.ts` (pure): the question, the ≤5 / floor / in-library /
  duplicate rules, the re-keyed merge, the notes.
- `apps/api/test/edit-literature-api.spec.ts` (Postgres, Redis; indexes, vectors and the worker's
  read replaced): papers added, marked, filed into "Add into"; the prompt carries their abstracts
  and the library's passage; the result's citations are all library rows and an invented one is
  stripped; one unit and one EMBED row; nothing searched at the cap; empty, off-topic and failed
  searches and papers not read in time fall back with the line; a refund when the edit fails;
  an edit without passages and the switch off never search; someone else's chapter is a 404
  before anything is searched or spent.
- `apps/web/test/edit-literature.spec.ts`: the body (the switch and the library sent for the right
  edits, never on a follow-up), the list's words, the panel's wiring.
- `apps/web/e2e/edit-literature.spec.ts` (Playwright; the run answered in the page): the switch,
  the list with reader links, nothing changed until Replace, no sideways overflow at 375 px.
