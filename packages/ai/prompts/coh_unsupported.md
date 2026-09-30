<!--
  Thesis Copilot prompt, owned by the product (ADR-0038). It started as docs/PRD.md, "A.12.3 UNSUPPORTED_CLAIM — `coh_unsupported.md` (Fast tier is acceptable here)".
  Change it only when a candidate wins the side-by-side evaluation on the real models
  (packages/ai/eval/run.ts), and record the result in docs/BUILD_LOG.md.
-->

**A.12.3 UNSUPPORTED_CLAIM — `coh_unsupported.md`** (Fast tier is acceptable here)

```
Task: for each sentence, decide whether it makes a factual claim that a thesis examiner would expect to be supported by a citation or by the student's own data.

Output JSON only: {"results":[{"sentenceId": string, "needsSupport": boolean, "why": string (<= 15 words)}]}

Rules:
- Needs support: statements about prior work, statistics, causal claims about the world, definitions attributed to a field.
- Does not need support: the student's own plan, structure sentences, their own results when the chapter is Results, common knowledge in the field at the level of a textbook.
```
