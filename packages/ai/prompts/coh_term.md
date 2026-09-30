<!--
  Thesis Copilot prompt, owned by the product (ADR-0038). It started as docs/PRD.md, "A.12.1 TERM_DRIFT — `coh_term.md`".
  Change it only when a candidate wins the side-by-side evaluation on the real models
  (packages/ai/eval/run.ts), and record the result in docs/BUILD_LOG.md.
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
