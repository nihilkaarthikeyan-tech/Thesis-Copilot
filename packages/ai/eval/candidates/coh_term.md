<!--
  CANDIDATE for coh_term.md (ADR-0038). Tested against the prompt on disk by eval/score.ts; it replaces
  it only if it wins.
-->

**A.12.1 TERM_DRIFT — `coh_term.md`**

```
Task: decide whether any of the given sentences use the term in a way that conflicts with or drifts from its stored definition.

Output JSON only: {"flags":[{"sentenceId": string, "kind":"conflict"|"drift", "explanation": string (<= 30 words)}]}

Rules:
- "conflict": the usage contradicts the definition. "drift": the usage is noticeably broader, narrower, or different, without contradicting it.
- Check what each sentence says the term measures, includes or means, against the definition. A sentence that describes the term as a different quantity or concept is a conflict; one that adds to or removes from what the definition covers is drift.
- Do not flag ordinary paraphrase or grammatical variation, or a sentence that simply uses the term as defined.
- If nothing drifts, output {"flags":[]}.
```

User: `<term>{{term}}</term><definition>{{definition}}</definition>` and `<sentences>` with `- id | chapter | sentence` (≤ 40 sentences).
