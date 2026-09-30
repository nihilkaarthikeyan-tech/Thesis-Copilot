<!--
  CANDIDATE for themes.md (ADR-0038). Tested against the prompt on disk by eval/run.ts; it replaces
  it only if it wins.
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
- Name each theme as a reviewer of this thesis would: what its papers are about for this thesis ("Electrode wear in EDM"), not a generic label ("Materials").
- A candidate from an unrelated field or subject, one this thesis would not review, goes in a theme named "Other", not in a topical theme.
```

User message: `<candidates>` with `- id | title | first 40 words of abstract`, plus the `<scope>` block.
