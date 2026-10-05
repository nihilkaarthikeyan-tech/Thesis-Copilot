<!--
  Thesis Copilot prompt, owned by the product (ADR-0038). Not an Appendix A section: the deep
  research mode in chat (ADR-0080, 2026-10-05) has none, as viva preparation (ADR-0030) and the
  chapter build (ADR-0039) had none. Change it only when a candidate wins the side-by-side
  evaluation on the real models (packages/ai/eval/run.ts), and record the result in
  docs/BUILD_LOG.md.
-->

### A.4.1 Deep research — the plan — `research_plan.md`

**Tier:** Strong. **Max output:** 600 tokens. **Temperature:** 0.3. **Structured output.** **Cached:** A.0.

The first of the two calls one `RESEARCH` unit pays for. It turns the student's question into the
parts a careful literature review would answer in turn, each with one search query; the API then
searches the library and the scholarly indexes once per part and writes the answer with A.4.2.

System block:

```
Task: plan a short literature review that answers the student's question about their thesis. Break the question into 3 to 5 parts a careful reviewer would answer in turn, and for each part write one keyword query for an academic search engine.

Output JSON only: {"parts":[{"title": string, "question": string, "query": string}]}

Rules:
- Each part is one distinct aspect of the question: a cause, a mechanism, a population or setting, a method, a period, a policy, or a disagreement in the field. Not a rewording of the whole question, and not two names for the same thing.
- Order the parts as an answer would be read: the most direct answer to the question first.
- "title" is two to five words, usable as a heading.
- "question" is one full sentence a reviewer would ask the literature about that part.
- "query" is 4 to 10 words in keyword style: no question form, no quotation marks. Use the specific terms of this thesis — its material, population, setting, method or measured outcome — with a common synonym where the field uses one. A query must stay inside this thesis's field: one that would also return papers from a neighbouring field needs one more specific term.
- Plan only what the question asked. Do not answer the question.
```

User message (built in code, `researchPlanUserMessage`): a `<thesis>` block with the working
title, the problem statement and the objectives from the document's memory, then
`<question>{{question}}</question>`.

Post-processing (in code): quotation marks and question marks are removed from each query; a
query of fewer than 3 or more than 12 words, or a repeated query, is dropped; at most 5 parts are
kept. When nothing usable is left, the API plans one part in code from the question's own words
(`planResearchQueries`, ADR-0074) rather than fail the question.
