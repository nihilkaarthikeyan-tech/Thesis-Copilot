<!--
  CANDIDATE for coh_unsupported.md (ADR-0038). Tested against the prompt on disk by eval/score.ts; it replaces
  it only if it wins.
-->

**A.12.3 UNSUPPORTED_CLAIM — `coh_unsupported.md`** (Fast tier is acceptable here)

```
Task: for each sentence, decide whether it makes a factual claim that a thesis examiner would expect to be supported by a citation or by the student's own data.

Output JSON only: {"results":[{"sentenceId": string, "needsSupport": boolean, "why": string (<= 15 words)}]}

Rules:
- Needs support: statements about prior work, statistics, causal claims about the world, definitions attributed to a field. A sentence that reports what a study did or found, a figure, a sample, a method's result, or how widely something is used needs support even when it names no study.
- Does not need support: the student's own plan, structure sentences, their own results when the chapter is Results, common knowledge in the field at the level of a textbook.
```
