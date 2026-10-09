# 0133 — "Search the literature" on an AI edit: found papers join the library first

Date: 2026-10-09
Status: accepted (the owner's decision of 2026-10-09; Jenni build plan "next" item 5 / R8 (b);
amends ADR-0095's "Web switch: not built"). **Amended the same afternoon** (last section): no wait
for the worker, the search asks the selection's subject, and the keep rule is measured. Where
the two disagree, the amendment wins.

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

## Amendment 2026-10-09 (afternoon) — after the first live run

**What happened.** The coordinator ran the switch once on the real models
(`apps/web/e2e/_measure/edit-literature-live.spec.ts`, an untitled thesis with an empty library):
the selection "Many rural households in Karnataka have not installed rooftop solar panels even
though subsidies exist. The upfront cost and access to credit appear to matter.", the instruction
"Add evidence from published studies for each claim". In 39 s it added two barely relevant papers
("Utilizing Solar Photovoltaics to Improve Primary Health Care in Rural and Tribal Regions…",
2017; "A review of renewable off-grid mini-grids in Sub-Saharan Africa", 2023). Neither was read
within the 25 s wait, so the edit used the library alone and came back unchanged. On first use the
feature did nothing.

**Three causes, three changes.**

1. **The wait.** Removed. The abstract is already on the new `Source` row, so it is the edit's
   passage for that paper, tied to the new library row (`abstractPassages`): the paper is in the
   library, so grounding holds and `postProcessCommand` is unchanged. The worker still resolves,
   reads and embeds it in the background. A citation of it is sent with **no chunk id**
   (`realChunkId`); the editor already handles that (`aiTextToNodes`, pinned by a new
   `packages/ui/test/ai-text.spec.ts` case), and the citation card says "Cited from the library,
   with no passage attached" until the student opens the paper. A placeholder chunk was rejected:
   `index-source` replaces a paper's chunks, so any id written now would point at nothing later.
   The panel no longer has "(still being read)": every added paper is offered to the edit.
2. **The search.** The first version asked the keyword indexes with the instruction's words
   first — the replay below shows the queries "add published claim rural households karnataka
   installed rooftop" and "add published claim rural", which PubMed answered with rural
   health-care papers. `editSearchPlan` (`@tc/retrieval`, `edit-search.ts`) now searches the
   **selection's** content words (eight, then the first four; edit words such as add, cite,
   claim, published, evidence dropped), borrowing the instruction's only when the selection
   gives fewer than three. The instruction still reaches OpenAlex's semantic search.
3. **The line.** Relevance is now scored against the subject — the context (below) and the
   selection — never the instruction, and the rule is measured, not guessed: **cosine ≥ 0.66 and
   within 0.10 of the best paper found**, five at most (`EDIT_SEARCH`, `keepRelevant`).

**Context (c).** `editSearchContext` leads the semantic search and the relevance text with the
working or document title, the chapter title and its scope note — each only when it names
something (`namesNothing`: "Untitled thesis", "Chapter 2" and the like add nothing). The live run
had none of them, which is why the subject has to come from the selection.

### The measurement (2026-10-09, `apps/worker/scripts/edit-literature-relevance.ts`)

voyage-4; the indexes as `searchPlan` asks them (Semantic Scholar off: no key); ten pairs in ten
fields; ~54k embedding tokens for the whole run (about ₹0.29, inside the free tier). Cosine against
context + selection. "5th kept" is the lowest of the five the rule adds; "off-field, highest" are the
best-scoring papers about something else (or about a neighbouring question).

| Pair (context) | Best | 5th kept | Line (≥ 0.66 and best − 0.10) | Off-field, highest |
|---|---|---|---|---|
| Rooftop solar, Karnataka (untitled — the live run) | 0.778 | 0.716 | 0.678 | 0.654 off-grid solar demand, Rwanda; 0.614 rural electrification subsidy model; 0.533 cooking energy |
| Net metering (titled thesis) | 0.798 | 0.775 | 0.698 | 0.564 storage arbitrage; 0.516 smart meters, Italy |
| AlphaFold2 (titled) | 0.887 | 0.875 | 0.787 | 0.727 protein sequence generation |
| Fish sun-drying, Kerala (titled) | 0.773 | 0.704 | 0.673 | 0.573 renewable food drying; 0.548 sweet-potato drying |
| Mother-tongue instruction (untitled) | 0.795 | 0.734 | 0.695 | 0.514 metacognitive reading strategies; 0.453 classroom acoustics |
| Iron-folic acid, adolescent girls (titled) | 0.890 | 0.827 | 0.790 | 0.690 anaemia in pregnancy; 0.680 preconception nutrition |
| Back-translation, low-resource MT (titled) | 0.862 | 0.850 | 0.762 | 0.704 sign-language translation |
| Microfinance, self-help groups (untitled) | 0.771 | 0.704 | 0.671 | 0.576 microfinance and child nutrition |
| Fly ash in concrete (titled) | 0.863 | 0.852 | 0.763 | 0.743 waste glass in concrete; 0.733 GGBS; 0.650 leachate sludge |
| Bedtime smartphones, sleep (chapter only) | 0.889 | 0.877 | 0.789 | 0.593 toddlers in cribs; 0.550 toddlers' media |

Every pair adds five papers a reader would call on the passage, and every off-field paper is below
its pair's line. On-topic papers also fall below the line in a long list, which costs nothing
because only five are added. The margin does the work where the indexes answer well (waste glass
at 0.743 under fly ash's 0.863). The floor does it where they answer badly: a weak set, as the live
run got, adds nothing. The fixed 0.60 line would have let in the leachate sludge (0.650), the
plastic pavers (0.612) and the live run's health-care paper.

**Replay of the live run** (the first version's plan, and the live run's papers looked up by
title): "Utilizing Solar Photovoltaics to Improve Primary Health Care…" scored **0.615** on the
first version's measure (instruction + selection), over the 0.60 line, and **0.574** on the new
one, under 0.66 and 0.20 below the best. The mini-grids review could not be found again by title
with an abstract. The live run evidently got a weak candidate set (OpenAlex's results were not
among what it kept). With the new search, the same selection finds "The Last Mile of a Subsidy:
Household Frictions in Rooftop Solar Adoption in Karnataka" (0.779) and four more rooftop-solar
adoption papers at 0.716 or above. If only weak candidates come back, as they did live, the 0.66
floor now adds nothing and the line says so.

**Cost.** Unchanged: the same relevance call, now one text shorter, and at most 6 passages, the
abstracts cut at 2,000 characters (about a chunk). The run is faster, since there is no wait.
