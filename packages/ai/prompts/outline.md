<!--
  VERBATIM COPY OF PRD APPENDIX A — DO NOT EDIT BY HAND.

  PRD §0.3 rule 11: prompts are content, not code. If this prompt performs badly, record
  examples of the bad output in docs/BUILD_LOG.md and propose a change for the human to
  approve. Do not rewrite it here.

  Source: docs/PRD.md, "### A.9 Outline generation — `outline.md`"
  Regenerate: pnpm --filter @tc/ai run prompts:extract
-->

### A.9 Outline generation — `outline.md`

**Tier:** Strong. **Max output:** 3,000 tokens. **Temperature:** 0.3. **Structured output:** `OutlineNode[]` (§10.7.2).

```
Task: produce a thesis outline as a tree of chapters and sections.

Output JSON only: an array of OutlineNode: {"id": string (slug), "title": string, "scopeNote": string (2–4 sentences: what this part must establish and what it must not cover), "subTheme": string|null, "mappedFromPaperSection": string|null, "children": OutlineNode[]}

Rules:
- Follow the template shape given in <template>. Do not add or remove top-level chapters unless <template> says the count is flexible.
- Ground the Literature Review chapter's sections on <gap_map>: one section per sub-theme; for a theme marked thin, say so in the scopeNote ("Only N sources available; needs expansion").
- If <extraction> is present (the student's own paper), map its sections to chapters and set "mappedFromPaperSection". Then explicitly add what a thesis needs that the paper does not have (typically: extended literature review, methodology justification, limitations, future work), with scopeNotes that say what is missing.
- Scope notes are instructions for a writer, not summaries. Use imperative phrasing ("Establish…", "Compare…", "Do not discuss…").
- Ids are stable slugs like "ch2-literature-review", "ch2-sec3-adoption-barriers".
```

User message: `<template>` (name + expected chapter list), `<scope>`, `<gap_map>` (theme, count, thin), `<extraction>` (Path B only: sections + findings).
