<!--
  VERBATIM COPY OF PRD APPENDIX A — DO NOT EDIT BY HAND.

  PRD §0.3 rule 11: prompts are content, not code. If this prompt performs badly, record
  examples of the bad output in docs/BUILD_LOG.md and propose a change for the human to
  approve. Do not rewrite it here.

  Source: docs/PRD.md, "A.12.2 CLAIM_CONTRADICTION — `coh_claim.md`"
  Regenerate: pnpm --filter @tc/ai run prompts:extract
-->

**A.12.2 CLAIM_CONTRADICTION — `coh_claim.md`**

Two steps. Step 1, claim extraction: "List up to 25 checkable claims from the chapter text as JSON `{"claims":[{"id","text","span":[from,to]}]}`; a checkable claim states a number, a method detail, a result, or a definition; skip opinions and plans." Step 2, comparison:

```
Task: compare each claim with the passages retrieved from other chapters and report contradictions.

Output JSON only: {"flags":[{"claimId": string, "passageId": string, "severity":"ERROR"|"WARN", "explanation": string (<= 40 words)}]}

Rules:
- ERROR: the two cannot both be true (e.g. 200 participants vs 180 participants for the same study). WARN: they are in tension or use inconsistent figures/units without being strictly contradictory.
- Do not flag differences explained by scope (e.g. a subset vs the whole sample) when the text says so.
- If nothing contradicts, output {"flags":[]}.
```
