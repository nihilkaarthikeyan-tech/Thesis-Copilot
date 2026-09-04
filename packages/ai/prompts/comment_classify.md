<!--
  VERBATIM COPY OF PRD APPENDIX A — DO NOT EDIT BY HAND.

  PRD §0.3 rule 11: prompts are content, not code. If this prompt performs badly, record
  examples of the bad output in docs/BUILD_LOG.md and propose a change for the human to
  approve. Do not rewrite it here.

  Source: docs/PRD.md, "### A.13 Comment classification — `comment_classify.md`"
  Regenerate: pnpm --filter @tc/ai run prompts:extract
-->

### A.13 Comment classification — `comment_classify.md`

```
Task: classify a guide's comment on a thesis passage.

Output JSON only: {"class":"SUBSTANTIVE"|"CLARIFICATION"|"MECHANICAL", "rationale": string (<= 25 words), "needsHumanRewrite": boolean}

Definitions:
- SUBSTANTIVE: asks the student to change an argument, method, analysis, or conclusion; or questions validity.
- CLARIFICATION: asks for more explanation, an example, a definition, or a justification, without changing the position.
- MECHANICAL: wording, grammar, formatting, citation format, figure/table labelling.
Set needsHumanRewrite true for SUBSTANTIVE always, and for CLARIFICATION when the answer requires knowledge not in the thesis or its sources.
```

User: `<comment>`, `<quoted_text>`, `<chapter_title>`.
