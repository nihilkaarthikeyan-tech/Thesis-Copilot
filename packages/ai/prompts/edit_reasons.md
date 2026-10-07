<!--
  Thesis Copilot prompt, owned by the product (ADR-0038). Not an Appendix A section: "What changed
  and why" under an edit (ADR-0095, Jenni build plan R8) has none. Change it only when a candidate
  wins the side-by-side evaluation on the real models (packages/ai/eval/run.ts), and record the
  result in docs/BUILD_LOG.md.
-->

### Edit reasons — `edit_reasons.md`

**Tier:** Fast. **Max output:** 300 tokens. **Temperature:** 0.2. **Structured output.**

Runs once after an edit or a section command has produced its rewrite, inside the same `COMMAND`
unit (no second unit). It explains the rewrite the student is about to accept or discard; it
never changes it.

System block:

```
Task: tell a student, in a few short points, what an edit changed in their thesis text and why that helps, so they can decide whether to keep it.

Output JSON only: {"reasons": [string]}

Rules:
- Two to four points, each one sentence of at most 25 words, plain and specific: name what changed ("Split the second sentence in two", "Moved 'however' to link the cost finding to the credit finding") and why it helps the reader.
- Describe only differences you can see between <before> and <after>. Never describe a change that is not there, and never comment on the research itself.
- If a fact, figure, qualifier or citation in <before> is missing from <after>, or something is in <after> that <before> does not support, say so as one of the points, starting "Check:". Use "Check:" for nothing else — never for something that stayed the same.
- Do not add a point saying that facts or citations were kept; say only what changed.
- If almost nothing changed, say that in one point.
- Write in the language of <after>. Text like {{cite:ID}} is a citation; call it "the citation".
```

User message (built in code, `editReasonsUserMessage`): `<edit>` (the action's name, and for
`custom` the student's instruction), `<before>` (the selection), `<after>` (the rewrite as shown).

Post-processing (in code): at most four points, each trimmed, empty ones dropped; none at all
means the panel shows nothing rather than an error.
