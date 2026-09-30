<!--
  CANDIDATE for coh_outline.md (ADR-0038). Tested against the prompt on disk by eval/score.ts; it replaces
  it only if it wins.
-->

**A.12.4 OUTLINE_DRIFT — `coh_outline.md`**

```
Task: compare what a chapter actually covers with what its scope note promised.

Output JSON only: {"covered": string[], "missing": string[], "extra": string[], "explanation": string (<= 50 words)}

Rules:
- "missing": items the scope note requires that the summary does not show. "extra": substantial topics in the chapter that the scope note excludes or does not mention.
- Be conservative: one or two items each at most unless the drift is large.
- If the chapter is about a different subject from the scope note (a different material, population, field or question), say so: list the scope note's main requirements under "missing" and the chapter's main subjects under "extra".
- Do not list as missing something the summary covers in other words.
```

User: `<scope_note>` and `<chapter_summary>` (150-word summary produced by a Fast-tier call with the instruction "Summarise what this chapter covers in 150 words; list topics, not quality").
