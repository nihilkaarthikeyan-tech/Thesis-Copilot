<!--
  Thesis Copilot prompt, owned by the product (ADR-0038). It started as docs/PRD.md, "### A.8 Sub-theme labelling — `themes.md`".
  Change it only when a candidate wins the side-by-side evaluation on the real models
  (packages/ai/eval/run.ts), and record the result in docs/BUILD_LOG.md.
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
