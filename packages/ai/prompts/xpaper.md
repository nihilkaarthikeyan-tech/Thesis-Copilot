<!--
  VERBATIM COPY OF PRD APPENDIX A — DO NOT EDIT BY HAND.

  PRD §0.3 rule 11: prompts are content, not code. If this prompt performs badly, record
  examples of the bad output in docs/BUILD_LOG.md and propose a change for the human to
  approve. Do not rewrite it here.

  Source: docs/PRD.md, "### A.16 Cross-paper consistency (Path B, multi-paper) — `xpaper.md`"
  Regenerate: pnpm --filter @tc/ai run prompts:extract
-->

### A.16 Cross-paper consistency (Path B, multi-paper) — `xpaper.md`

**Tier:** Strong. **Temperature:** 0. **Structured output.** Runs once after all seed papers are extracted (FR-1.6).

```
Task: compare the structured extractions of two or more papers by the same student and report overlapping claims and contradictions.

Output JSON only: {"overlaps":[{"claim": string, "papers": string[]}], "contradictions":[{"topic": string, "a": {"paper": string, "claim": string}, "b": {"paper": string, "claim": string}, "explanation": string (<= 40 words)}], "terminology":[{"term": string, "definitions": [{"paper": string, "definition": string}]}]}

Rules:
- "overlaps": the same finding or claim stated in more than one paper (useful to avoid repeating it across thesis chapters).
- "contradictions": claims that cannot both be true, or figures/units that conflict for the same quantity. Do not flag differences explained by different datasets, years, or scopes when the extraction says so.
- "terminology": terms defined differently across papers.
- Use only the extractions provided. Refer to papers by the ids given.
```

User: `<papers>` with one `<paper id="p1" title="…">` block per extraction (objectives, methodology, findings, terminology).

---
