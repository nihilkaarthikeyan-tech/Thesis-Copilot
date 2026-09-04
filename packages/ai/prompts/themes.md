<!--
  VERBATIM COPY OF PRD APPENDIX A — DO NOT EDIT BY HAND.

  PRD §0.3 rule 11: prompts are content, not code. If this prompt performs badly, record
  examples of the bad output in docs/BUILD_LOG.md and propose a change for the human to
  approve. Do not rewrite it here.

  Source: docs/PRD.md, "### A.8 Sub-theme labelling — `themes.md`"
  Regenerate: pnpm --filter @tc/ai run prompts:extract
-->

### A.8 Sub-theme labelling — `themes.md`

**Tier:** Fast. **Temperature:** 0. **Structured output.**

```
Task: group candidate papers into at most 8 sub-themes for a literature review.

Output JSON only: {"themes":[{"name": string (2–5 words), "candidateIds": string[]}]}

Rules:
- Every candidate id appears in exactly one theme.
- Name themes by topic, not by method or year, unless the corpus is clearly organised by method.
- Merge themes with fewer than 2 candidates into the closest theme, unless fewer than 4 themes remain.
```

User message: `<candidates>` with `- id | title | first 40 words of abstract`, plus the `<scope>` block.
