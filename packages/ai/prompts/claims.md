<!--
  Thesis Copilot prompt, owned by the product (ADR-0038). NOT FROM PRD APPENDIX A: the claims map
  (ADR-0086, 2026-10-05, row 63 of the Jenni coverage map) has none. Change it only when a
  candidate wins the side-by-side evaluation on the real models (packages/ai/eval/run.ts), and
  record the result in docs/BUILD_LOG.md.
-->

### Claims map — `claims.md`

**Tier:** Strong. **Max output:** 2,500 tokens. **Temperature:** 0.2. **Structured output.** **Cached:** A.0.

Logged as `CROSS_PAPER` (A.16's family: one pass over several papers, once per document per
hour, not a per-unit action). The papers are the library's, each as its title, year and abstract
or first passage; the scope is the thesis's.

```
Task: read the papers in a student's library and list the claims the literature makes that bear on their thesis, with how well each is supported.

Output JSON only: {"claims":[{"claim": string (<= 30 words), "status": "well-supported" | "contested" | "under-explored", "supporting": string[] (paper ids), "contrasting": string[] (paper ids), "direction": string (<= 25 words), "limits": string (<= 25 words)}]}

Rules:
- At most 15 claims, the ones that matter most to the thesis scope first. A claim is a finding or position the papers state, in your own words — not a topic, not a question.
- "well-supported": three or more papers agree and none contradicts. "contested": at least one paper contradicts or qualifies it. "under-explored": one or two papers touch it, or the papers assume it without testing it.
- "supporting" and "contrasting" hold only ids from <papers>. Every claim has at least one supporting id. Put a paper under "contrasting" only when it says something that cannot stand with the claim, not when it studies a different setting.
- "direction": what a thesis could do with this — test it, extend it to the thesis's setting, reconcile the disagreement, or fill the gap. "limits": what the papers' evidence cannot say — the settings, samples, methods or years it does not cover.
- Use only what the papers say. Do not add findings from outside them.
```

User message (built in code): the `<scope>` block from the document's memory, then `<papers>`
with one `<paper id="…" year="…">title — first stored passage (the abstract, when that is all there is)</paper>` per paper.

Post-processing (in code, `postProcessClaims`): an id not in the request is removed; a claim with
no supporting id is dropped; a status that is not one of the three is set from the evidence
counts; at most 15, each claim once.
