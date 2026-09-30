<!--
  Thesis Copilot prompt, owned by the product (ADR-0038). It started as docs/PRD.md, "### A.13 Comment classification — `comment_classify.md`".
  Change it only when a candidate wins the side-by-side evaluation on the real models
  (packages/ai/eval/run.ts), and record the result in docs/BUILD_LOG.md.
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
