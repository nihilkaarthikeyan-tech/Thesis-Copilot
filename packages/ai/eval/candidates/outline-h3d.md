<!--
  CANDIDATE for outline.md (Jenni build plan R5b, sub-headings, fourth try 2026-10-09, ADR-0092
  addendum 4). outline-h3c won its judged round but, planned from the title alone (no gap map),
  left the Literature Review with 0, 5 and 1 sections. This one says what to do when <gap_map> is
  empty, and gives sub-sections to Methodology always but to the Literature Review only where the
  gap map has named its themes.
-->

### A.9 Outline generation — `outline.md`

**Tier:** Strong. **Max output:** 3,000 tokens. **Temperature:** 0.3. **Structured output:** `OutlineNode[]` (§10.7.2).

```
Task: produce a thesis outline as a tree of chapters and sections.

Output JSON only: an array of OutlineNode: {"id": string (slug), "title": string, "scopeNote": string (2–4 sentences: what this part must establish and what it must not cover), "subTheme": string|null, "mappedFromPaperSection": string|null, "children": OutlineNode[]}

Rules:
- Follow the template shape given in <template>. Do not add or remove top-level chapters unless <template> says the count is flexible.
- Ground the Literature Review chapter's sections on <gap_map>: one section per sub-theme; for a theme marked thin, say so in the scopeNote ("Only N sources available; needs expansion").
- If <gap_map> is missing or empty (no literature has been searched yet), still give the Literature Review five or six sections: the themes the literature on this topic would cover, each named specifically for this thesis. Never leave the Literature Review without sections and never write a placeholder for a theme.
- If <extraction> is present (the student's own paper), map its sections to chapters and set "mappedFromPaperSection". Then explicitly add what a thesis needs that the paper does not have (typically: extended literature review, methodology justification, limitations, future work), with scopeNotes that say what is missing.
- Scope notes are instructions for a writer, not summaries. Use imperative phrasing ("Establish…", "Compare…", "Do not discuss…").
- Make every title and scope note specific to this thesis: name its material, method, population, setting and variables from <scope>. A heading that could appear unchanged in any thesis ("Background", "Discussion of results") needs a scope note that says exactly what this thesis must establish there.
- Tie the chapters together: the methodology chapter says how each objective in <scope> will be addressed, and the results and discussion chapters say which objective each part answers.
- Write section titles as a reader would scan them: short, concrete, no numbering, no colons unless needed.
- Write every section's own scopeNote first, as full and specific as the rules above ask; sub-sections never replace or shorten it.
- Then add sub-sections in two places only. In the Methodology chapter, give each section that has two or three parts a reader would look for separately those parts as children. In the Literature Review, do the same only when <gap_map> is present, for a theme that has such parts. A child has a short title and one sentence saying what that part covers that its siblings do not. Every other section has no children. Never go deeper than this.
- Ids are stable slugs like "ch2-literature-review", "ch2-sec3-adoption-barriers".
```

User message: `<template>` (name + expected chapter list), `<scope>`, `<gap_map>` (theme, count, thin), `<extraction>` (Path B only: sections + findings).
