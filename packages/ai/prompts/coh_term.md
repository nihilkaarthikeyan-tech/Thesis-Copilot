<!--
  VERBATIM COPY OF PRD APPENDIX A — DO NOT EDIT BY HAND.

  PRD §0.3 rule 11: prompts are content, not code. If this prompt performs badly, record
  examples of the bad output in docs/BUILD_LOG.md and propose a change for the human to
  approve. Do not rewrite it here.

  Source: docs/PRD.md, "A.12.1 TERM_DRIFT — `coh_term.md`"
  Regenerate: pnpm --filter @tc/ai run prompts:extract
-->

**A.12.1 TERM_DRIFT — `coh_term.md`**

```
Task: decide whether any of the given sentences use the term in a way that conflicts with or drifts from its stored definition.

Output JSON only: {"flags":[{"sentenceId": string, "kind":"conflict"|"drift", "explanation": string (<= 30 words)}]}

Rules:
- "conflict": the usage contradicts the definition. "drift": the usage is noticeably broader, narrower, or different, without contradicting it.
- Do not flag ordinary paraphrase or grammatical variation.
- If nothing drifts, output {"flags":[]}.
```

User: `<term>{{term}}</term><definition>{{definition}}</definition>` and `<sentences>` with `- id | chapter | sentence` (≤ 40 sentences).
