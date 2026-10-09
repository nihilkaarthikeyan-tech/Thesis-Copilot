# 0074 — Chat that researches when the library is thin, answers in parts, on the strong tier

Date: 2026-10-05
Status: accepted
Follows: the side-by-side study (`docs/research/side-by-side-2026-10-05.md`, §8, item C2);
ADR-0060 (chat beyond the library), ADR-0037 (automatic sources), ADR-0038 (prompts are owned
and change only by evaluation), ADR-0050 (search time budgets), ADR-0070 (the short budget).

## Context

Both tools were asked "What are the main financial barriers to rooftop solar adoption for rural
households in India, according to my sources?". Jenni (~70 s) showed its steps, searched the
literature itself, and answered in six headed sections with ten-plus citations. Ours (<8 s)
answered in one dense paragraph with two citations, from the five papers in the library. The
model was not the difference; what it was given, and the 180-word single-paragraph rule in A.4,
were.

## Decisions

1. **When the library is thin, chat searches too — in the same request, on the same CHAT unit.**
   "Thin" is decided in code (`libraryCoverage`, `@tc/retrieval`) from the passages retrieval
   already returned: fewer than **4** passages at cosine ≥ **0.55**, or those passages from fewer
   than **4** distinct papers. Measured on the dev libraries with voyage-4
   (`apps/api/scripts/chat-research-thresholds.ts`, `docs/BUILD_LOG.md`): a five-paper library put
   three papers in the top eight for every question (the side-by-side's situation); a ten-paper
   library put five to seven, and its research is skipped; a two-paper library is always thin.
   Off-topic questions (< 0.30) are still refused before any of this, unchanged.
   It does not run when the student turned "Search beyond my library" **off**, named papers with
   `@` (those papers are the whole ground), or asked in the document scope. Under the default
   "Ask first" it runs: ADR-0060's ask-first guards against a *charged answer replacing a free
   refusal*; here the student is already getting (and paying one unit for) a library answer, and
   every search is shown as it happens.

2. **The plan is made in code, not by a model** (`planResearchQueries`). A.7 (`queries.md`) does
   not fit: it plans four to six queries from a thesis scope, on the strong tier, as a second
   metered call. The plan: OpenAlex's semantic search with the thesis title and the question as
   written, and the question's content words as a keyword search (at most eight, minus the words
   of asking — "main", "according", "sources"), plus its first four when there were more than
   four, because PubMed ANDs every term and a long query can return almost nothing. Every index
   the API knows is asked (OpenAlex, Semantic Scholar when keyed, PubMed, arXiv), each within
   8 s a call and 12 s an index (`CHAT_RESEARCH.budget`, the first-session budget of ADR-0070).

3. **Only on-topic abstracts join**: candidates with an abstract, not already in the library (the
   library's passages speak for those), at most 24 embedded as title + the first 1,200
   characters, kept at cosine ≥ **0.60** against the thesis title and question, best six. Measured
   on PubMed and arXiv (OpenAlex answered 429 on the dev machine): the papers a reader would call
   on the question scored 0.61–0.81; mortgage lending for a solar-credit question, rural-women
   health studies for a solar-decision question, and electric stoves for solar barriers scored
   0.53–0.58. 0.60 is also `AUTO_SOURCES.addCosine`, measured the same way in ADR-0037.

4. **Grounding is unchanged.** The abstracts are passages (`Sweb<n>#cabstract`, ADR-0060's ids),
   marked `origin="search"` in the prompt; `postProcessChat` whitelists exactly the library
   passages and abstracts that were sent, and strips and counts anything else as
   `HALLUCINATED_CITE`. A found paper's citation carries the paper, as ADR-0060's do.

5. **Add to library is offered, not automatic.** Each found paper the answer cited is listed under
   it with **Add**, and **Add all** when there are several — through the ordinary
   `/sources/resolve` path. Not ADR-0037's automatic adding: that is bounded by five or twenty
   searches a month and an admin switch, and a question asked to *learn* something should not
   silently grow the library the drafts cite from. "Add to document" is hidden on an answer that
   cites a found paper, with a line saying to add the papers first — a paper not in the library
   cannot become a thesis citation (flag, don't fix).

6. **Every step is visible**: "Searching your library…", "Reading 8 passages from 3 sources",
   "Your library has 3 papers on this, so I am searching the literature too…", "Searching
   OpenAlex for: <question>…", "Searching OpenAlex, PubMed and arXiv for: <query>…", "Reading 12
   abstracts…", "2 of 12 are on your question" (or "None of them is close enough to your
   question; answering from your library"), "Writing the answer…". Steps carry `params`, so the
   panel says them in Hindi too. A failed or slow search never fails the question: the library
   answers alone, and a step says so.

7. **The answer comes in parts.** A.4 (`chat.md`) changed after winning an evaluation round on the
   strong tier (`docs/BUILD_LOG.md`, 8 wins to 0, 3 ties; mean 7.50 → 8.45; hallucinated
   citations 0 → 0; answers with headings 0 → 11 of 11; sentences with a citation 77% → 89%):
   a one- or two-sentence direct answer, then a "### Part" heading per part, a citation on every
   finding, "### What these sources do not cover" when something is missing, at most 350 words.
   `CHAT.maxTokens` 600 → 900 so it is not cut off. The panel renders headings as headings;
   copying and "Add to document" turn them into plain lines (a chat heading is not a thesis
   heading).

8. **The chat answer's tier is one setting, `AI_CHAT_TIER`** (`fast` | `strong`, default
   **`strong`**, the owner's decision of 2026-10-05). It sets the request's tier, the model
   logged, the price `computeCallCost` charges and the latency metric's label, for library,
   research and beyond answers alike. `AI_CHAT_TIER=fast` switches back without code.

## Cost (what the research path adds to one thin question)

Not folded into `docs/COSTING.md` or the CHAT cost constants here: the lead is re-costing CHAT
for the strong tier on main. What to account for:

- **Model calls:** none extra. Still one chat call per question.
- **Embedding:** one Voyage call over the question line and at most 24 candidates of ≤1,200
  characters — at most ~7,500 tokens (₹0.039 at $0.06/M and ₹87/$); measured 261–3,447 tokens
  (≤ ₹0.018). Logged as an `EMBED` `AiCallLog` row against the student, so `UsageService`'s ₹100
  hard stop counts it.
- **Index requests:** one OpenAlex semantic search and up to two keyword queries on each keyword
  index (up to 7–9 HTTP requests). No money; OpenAlex's key credits.
- **Chat input:** up to six abstracts (≤1,800 characters each, ~450 tokens) on top of the library's
  eight passages — at most ~2,700 input tokens more (14 passages, ~5,500 tokens of passages).
- **Chat output:** answers are longer under the new A.4 whether or not research ran — mean 147 →
  226 words in the evaluation, i.e. ~+50% output tokens; the cap is 900 (plus reasoning headroom).
- **Time:** the search adds 1–4 s (measured), at most ~12 s by the budget; the strong-tier answer
  took a median 7.6 s in the evaluation against 5.4 s for the old prompt.
- **The unit:** one CHAT unit a question, taken before any provider call; refunded when the answer
  fails, as before. A failed search is not refunded, because the answer is still given.

## Not done

- OpenAlex's contribution to the kept abstracts is unmeasured (429 on the dev machine);
  `docs/PENDING.md` has the production check.
- The note under an answer is English in every language (it comes from the server).
- The off-topic → beyond path (ADR-0060) still runs its single search; it now answers on the chat
  tier and with the new A.4, but not with this plan.

## Amended 2026-10-08

Under "Ask first" the top-up no longer runs without asking: a thin library is offered the search
(Allow this time / Always allow / Skip) before the model is called, free, and searches only on
Allow. ADR-0116, "Amendment 2026-10-08", item 2. "On" is unchanged.

