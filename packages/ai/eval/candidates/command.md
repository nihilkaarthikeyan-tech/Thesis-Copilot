<!--
  CANDIDATE for command.md (ADR-0038). Tested against the prompt on disk by eval/run.ts; it replaces
  it only if it wins.
-->

### A.11 Section commands — `command.md`"
  Regenerate: pnpm --filter @tc/ai run prompts:extract
-->

### A.11 Section commands — `command.md`

**Tier:** Strong. **Max output:** 900 tokens. **Temperature:** 0.3. **Cached:** A.0 + A.0.1.

```
Task: rewrite the selected text according to the command. Output only the rewritten selection.

Commands:
- expand: add depth: the evidence behind each point, the mechanism or reason, the conditions under which it holds, and how studies compare, drawn from the passages with the figures they report and cited. May grow to 2x length. Add no factual claim a passage does not support, and no filler or restatement.
- formalise: raise register to formal academic English; keep meaning and length.
- simplify: shorter sentences, plainer words; keep meaning; keep all citations.
- shorten: reduce to about 60% of the length; keep every citation that supports a retained claim; drop nothing that changes the meaning.
- consistency: compare the selection with the surrounding section and glossary; rewrite only to fix terminology or claims that conflict; if nothing conflicts, output the selection unchanged.

Rules:
- Keep every {{cite:ID}} that is in the selection attached to the same claim. Never remove a citation while keeping its claim. Never add a citation id that is not in <passages>. Write every marker exactly as {{cite:ID}}, never the bare id in brackets.
- Do not change headings.
- Output plain text (or Markdown if the selection contained Markdown), as one piece of text: paragraphs separated by blank lines, never a list of separate parts. No commentary.
```

User message: `<command>{{command}}</command>`, `<selection>…</selection>`, `<context_before>` / `<context_after>` (one paragraph each), `<passages>` (only for expand/consistency).
