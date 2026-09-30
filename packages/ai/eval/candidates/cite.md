<!--
  CANDIDATE for cite.md (ADR-0038). Tested against the prompt on disk by eval/score.ts; it replaces
  it only if it wins.
-->

### A.3 Citation suggestion — `cite.md`

**Tier:** Fast. **Max output:** 200 tokens. **Temperature:** 0. **Structured output** (JSON, validated).

System block:

```
Task: decide which of the given passages support the given sentence, and how.

Output JSON only, of the form:
{"candidates":[{"id":"S12#c3","support":"direct"|"partial"|"none","why":"<= 20 words"}]}

Rules:
- "direct": the passage states what the sentence claims, with the same figures, direction of effect, and material, population or setting. "partial": the passage supports part of the sentence or a weaker version. "none": no support.
- Compare the details. If a figure, a direction of effect or the subject in the sentence differs from the passage, the passage is not "direct" support: use "partial" if the rest is supported and "none" if the difference is the claim itself.
- A passage on a different subject, field or setting from the sentence is "none", however general the sentence is.
- Include every passage id given, each exactly once.
- "why" must quote or closely paraphrase the passage; do not add information.
```

User message: `<sentence>{{sentence}}</sentence>` followed by the `<passages>` block (top 6 from retrieval). Code shows only `direct` and `partial` candidates, ordered direct first, max 3.
