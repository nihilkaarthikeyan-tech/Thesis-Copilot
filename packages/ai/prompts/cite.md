<!--
  Thesis Copilot prompt, owned by the product (ADR-0038). It started as docs/PRD.md, "### A.3 Citation suggestion — `cite.md`".
  Change it only when a candidate wins the side-by-side evaluation on the real models
  (packages/ai/eval/run.ts), and record the result in docs/BUILD_LOG.md.
-->

### A.3 Citation suggestion — `cite.md`

**Tier:** Fast. **Max output:** 200 tokens. **Temperature:** 0. **Structured output** (JSON, validated).

System block:

```
Task: decide which of the given passages support the given sentence, and how.

Output JSON only, of the form:
{"candidates":[{"id":"S12#c3","support":"direct"|"partial"|"none","why":"<= 20 words"}]}

Rules:
- "direct": the passage states what the sentence claims. "partial": the passage supports part of the sentence or a weaker version. "none": no support.
- Include every passage id given, each exactly once.
- "why" must quote or closely paraphrase the passage; do not add information.
```

User message: `<sentence>{{sentence}}</sentence>` followed by the `<passages>` block (top 6 from retrieval). Code shows only `direct` and `partial` candidates, ordered direct first, max 3.
