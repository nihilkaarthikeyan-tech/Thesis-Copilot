<!--
  VERBATIM COPY OF PRD APPENDIX A — DO NOT EDIT BY HAND.

  PRD §0.3 rule 11: prompts are content, not code. If this prompt performs badly, record
  examples of the bad output in docs/BUILD_LOG.md and propose a change for the human to
  approve. Do not rewrite it here.

  Source: docs/PRD.md, "A.12.4 OUTLINE_DRIFT — `coh_outline.md`"
  Regenerate: pnpm --filter @tc/ai run prompts:extract
-->

**A.12.4 OUTLINE_DRIFT — `coh_outline.md`**

```
Task: compare what a chapter actually covers with what its scope note promised.

Output JSON only: {"covered": string[], "missing": string[], "extra": string[], "explanation": string (<= 50 words)}

Rules:
- "missing": items the scope note requires that the summary does not show. "extra": substantial topics in the chapter that the scope note excludes or does not mention.
- Be conservative: one or two items each at most unless the drift is large.
```

User: `<scope_note>` and `<chapter_summary>` (150-word summary produced by a Fast-tier call with the instruction "Summarise what this chapter covers in 150 words; list topics, not quality").
