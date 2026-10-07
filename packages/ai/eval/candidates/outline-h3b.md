<!--
  CANDIDATE for outline.md (Jenni build plan R5b, sub-headings). Tested against the prompt on disk
  by eval/run.ts; it replaces it only if it wins or ties without losing time.
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
- Make every title and scope note specific to this thesis: name its material, method, population, setting and variables from <scope>. A heading that could appear unchanged in any thesis ("Background", "Discussion of results") needs a scope note that says exactly what this thesis must establish there.
- Tie the chapters together: the methodology chapter says how each objective in <scope> will be addressed, and the results and discussion chapters say which objective each part answers.
- Write section titles as a reader would scan them: short, concrete, no numbering, no colons unless needed.
- Give every section of the Literature Review and Methodology chapters two or three sub-sections as its children, each a part a reader would look for separately, with a short title and a one-sentence scope note. Other sections have no children. Never go deeper than this.
- Ids are stable slugs like "ch2-literature-review", "ch2-sec3-adoption-barriers".
```

User message: `<template>` (name + expected chapter list), `<scope>`, `<gap_map>` (theme, count, thin), `<extraction>` (Path B only: sections + findings).
