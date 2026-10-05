# 0080 — Deep research in chat: a planned, searched, part-by-part answer on its own allowance

Date: 2026-10-05
Status: accepted (agent, under ADR-0059; the owner asked for "a deeper research mode for chat")
Follows: ADR-0074 (chat searches when the library is thin), ADR-0077 (chat on the strong tier),
ADR-0060 (chat beyond the library), ADR-0038 (prompts are owned and change by evaluation), the
side-by-side study (`docs/research/side-by-side-2026-10-05.md` §8) and the same-topic run
(ADR-0078 addendum).

## Context

Both studies ended with one place where Jenni was clearly ahead: research chat. Asked the same
question of the same library, Jenni ran about eight searches for two minutes, read seventeen
sources and answered in ~1,100 words with real figures and advice on structuring the section.
Ours, after ADR-0074, ran one plan of two or three searches when the library was thin and
answered in ~350 words in 12–14 s. Ours is the better ordinary answer; it is not the thing a
student wants when they are starting a section and need the literature laid out.

The difference is work, not model: how many questions are asked of the indexes, how much is
read, and how long the answer may be. That work costs, so it cannot be the default for every
chat question.

## Decision

1. **A mode the student asks for by name.** A "Research deeply" switch under the chat box, in the
   library scope with no `@` papers. Switched on, the next question is deep research; it
   switches itself off after, because each one is a deliberate spend. The server ignores the
   flag in the document scope or with `@` papers (the panel does not offer it there), and refuses
   it when "Search beyond my library" is off in Settings, before any unit is taken: deep research
   is a literature search, and the student turned those off.

2. **Its own allowance, `RESEARCH`:** 1 a month on the trial, 3 on the paid plans, named "Deep
   research questions" (`ALLOWANCE_NAMES`), with the cap check and increment in the one atomic
   statement every metered action uses, before any provider call. A CHAT unit is never taken for
   it. Refunded when the answer fails and when nothing at all was found to read.

3. **Two strong-tier calls, two new prompts**, neither an Appendix A section (as ADR-0030 and
   ADR-0039 added theirs):
   - **A.4.1 `research_plan.md`**: from the thesis scope and the question, 3–5 parts a careful
     reviewer would answer in turn, each with a keyword query. Structured output; its rules are
     checked in code (`cleanResearchPlan`: keyword style, 3–12 words, no repeats, at most 5). A
     failed or empty plan is planned in code from the question's words (ADR-0074's planner), one
     part; the question is never failed for its plan.
   - **A.4.2 `chat_deep.md`**: A.4 as evaluated on 2026-10-05, extended: a direct answer, one
     headed section per part of the plan in order, "Where the studies disagree", "What these
     sources do not cover", and "For your thesis" (advice, not thesis text). At most 900 words,
     2,200 output tokens, a citation on every finding.

4. **What is searched and read.** For each part, in order: the library (`ContextService.retrieve`
   on the part's title and question, eight passages) and every scholarly index (`searchPlan`, the
   part's query as the keyword search, the thesis title and the part's question as OpenAlex's
   semantic search), within ADR-0074's budget per part. The question as asked is retrieved too.
   The library's passages are merged over all the parts by raw cosine, a passage once, no paper
   more than 4 of the 16 while another paper has candidates (ADR-0078's draft rule). The found
   papers are merged once each (by DOI, else title), at most 60, embedded once with the question
   and the parts, and kept at cosine ≥ 0.60 (`CHAT_RESEARCH.keepCosine`, measured in ADR-0074)
   against the question or any part, best 12. A library with nothing near the question
   contributes nothing; the searches may still answer.

5. **Grounding is unchanged.** The request holds at most 28 passages; `postProcessChat` whitelists
   exactly those; anything else is stripped and counted as `HALLUCINATED_CITE`. A found paper's
   citation carries the paper with Add (ADR-0060's shape), and "Add to document" is hidden until
   the papers are in the library, as ADR-0074 does. Nothing enters the thesis.

6. **Every step is shown**, with `params` for the Hindi interface: "Planning the research…",
   "Planned 5 parts: …", "Part 2 of 5, Access and infrastructure: searching your library and the
   indexes for: …", "Reading 9 passages from 4 sources", "Reading 60 abstracts…", "12 of 60 are
   on your question", "Writing the answer, part by part…". The plan is kept on the stored turn
   and shown under the answer ("Parts: …").

7. **Time limits on both calls** (the chapter build's lesson): 30 s for the plan, 150 s for the
   answer, combined with the request's own abort signal.

## Proof (real models, the dev stack, 2026-10-05)

A fresh account, a thesis created from the title "Mobile banking and the financial inclusion of
rural women in Tamil Nadu" (five papers found on creation, ADR-0070), then the question "What
stops rural women in India from using mobile banking, according to the research?" with the
switch on.

| | |
|---|---|
| Time to the answer | 35 s (plan 6.2 s; answer 34.7 s from the question's start) |
| Parts planned | 5: usage patterns; access and infrastructure; digital and financial literacy; socio-cultural barriers; institutional trust and services |
| Read | 9 library passages from 4 papers; 60 abstracts found over the 5 searches, 12 kept |
| Answer | 648 words, 8 sections, 13 distinct citations (3 library passages, 10 found papers), 0 hallucinated |
| Cost | ₹0.51: plan ₹0.091 (685 in, 438 out), answer ₹0.355 (5,835 in, 1,310 out), embedding ₹0.064 (12,300 tokens) |

The answer opened with a direct answer, gave each part three sentences with the figures the
passages held, named where the studies differ (convenience and trust against literacy and
self-efficacy), what is missing (district-level prevalence for Tamil Nadu, longitudinal
intervention evidence), and which found papers to add for which claim. Two cosmetic faults of the
model's own: a "Direct answer:" label, seen in ADR-0074's round too, and one mistyped heading.

## Cost

- **Per question**, priced at its ceiling in `ACTION_PROFILES.RESEARCH` (plan 2,500 in / 900 out;
  answer 12,500 in / 3,400 out, reasoning included; 4,000 cached once per call): **₹1.09** on
  `gpt-5-mini`. The proof cost ₹0.51. The embedding is its own `EMBED` row (under ₹0.10), as
  ADR-0074's is, so the ₹100 hard stop sees it.
- **Per student**, worst case for a fully active one: STUDENT at the production models goes
  from ₹70.73 to **₹74.00**; with `gpt-4.1-mini` on the fast tier (ADR-0051) from ₹89.85 to
  **₹93.13**, within the ₹100 ceiling. `pnpm ai:verify` prints it; pinned in
  `packages/config/test/cost-model.spec.ts`.
- The cap is three a month, not more, because of that ceiling: it is the allowance to raise
  first if the owner's limits rebalance (`docs/PENDING.md`) frees room.

## What was not done, and why

- **No full-text fetch of found papers.** Jenni's figures come from abstracts too; the library's
  own passages are full text. Fetching and reading PDFs inside a question would take minutes and
  belongs to the worker (add the paper, ask again).
- **No evaluation round for the two prompts yet.** They are new, not changes to an evaluated
  prompt, and ADR-0038's bar — a candidate beating the current prompt — has no current prompt to
  beat. The proof above is one real run, read. An `eval/run.ts chat_deep` round against A.4 on the
  same question is in `docs/PENDING.md`; until then the prompts stand on the proof.
- **The Hindi step strings are translated by the agent**, as ADR-0061's were; a native reader has
  not checked them.

## Tests

- `packages/ai/test/deep-research.spec.ts` (7): the two requests, the plan's cleaning, the mock,
  the passage cap, A.4's grounding.
- `apps/api/test/chat-deep.spec.ts` (8): the merge over parts with the per-paper cap, a paper
  once, the best-cosine scoring, the words.
- `apps/api/test/chat-deep-api.spec.ts` (7, Testcontainers): the steps in order; one search per
  part; one `RESEARCH` unit and no CHAT unit; the two RESEARCH rows and the EMBED row; only
  request passages cited; the plan on the stored turn; a failed plan and failed searches survive;
  the refund when the answer fails and when nothing was found; **the cap test** (the trial's one
  question, refused with no call); refused when searching is off; not deep research with `@`
  papers or in the document scope.
- `apps/web/e2e/chat-deep.spec.ts`: the switch, the request body, the steps, the answer with
  its plan and found papers, the switch off again, not offered in the document scope.
- `packages/config` (E.2 completeness, the caps table, the budget pins) and `packages/db`
  (enum parity) updated.
