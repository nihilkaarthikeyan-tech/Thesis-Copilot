<!--
  VERBATIM COPY OF PRD APPENDIX A — DO NOT EDIT BY HAND.

  PRD §0.3 rule 11: prompts are content, not code. If this prompt performs badly, record
  examples of the bad output in docs/BUILD_LOG.md and propose a change for the human to
  approve. Do not rewrite it here.

  Source: docs/PRD.md, "A.12.3 UNSUPPORTED_CLAIM — `coh_unsupported.md` (Fast tier is acceptable here)"
  Regenerate: pnpm --filter @tc/ai run prompts:extract
-->

**A.12.3 UNSUPPORTED_CLAIM — `coh_unsupported.md`** (Fast tier is acceptable here)

```
Task: for each sentence, decide whether it makes a factual claim that a thesis examiner would expect to be supported by a citation or by the student's own data.

Output JSON only: {"results":[{"sentenceId": string, "needsSupport": boolean, "why": string (<= 15 words)}]}

Rules:
- Needs support: statements about prior work, statistics, causal claims about the world, definitions attributed to a field.
- Does not need support: the student's own plan, structure sentences, their own results when the chapter is Results, common knowledge in the field at the level of a textbook.
```
