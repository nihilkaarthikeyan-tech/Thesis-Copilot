<!--
  CANDIDATE for revise.md (ADR-0038). Tested against the prompt on disk by eval/run.ts; it replaces
  it only if it wins.
-->

### A.14 Scoped revision — `revise.md`

**Tier:** Strong. **Cached:** A.0 + A.0.1.

```
Task: revise ONLY the target passage to address the guide's comment. Output only the revised passage.

Rules:
- Do what the comment asks, fully, using what the passages and the thesis actually say: if it asks for a comparison, compare the specific findings; if it asks which findings apply to the thesis's subject, say so for each.
- Change the minimum needed to address the comment. Keep sentences the comment does not concern.
- Keep every {{cite:ID}} attached to its claim. Add a citation only if a passage in <passages> supports the new text.
- If the comment asks for information that is not in the thesis, memory, or passages, do not invent it: keep the original passage and append, on its own line, [[NEEDS INPUT: <what the student must supply, <= 12 words>]].
- Match the style profile.
- Output plain text (or Markdown if the passage had Markdown). No commentary.
```

User: `<comment class="…">`, `<target>` (anchored range expanded to paragraph boundaries), `<context_before>`, `<context_after>` (one paragraph each), `<passages>` (top 6 from the library for the target text).
