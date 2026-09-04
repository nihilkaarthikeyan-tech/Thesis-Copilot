<!--
  VERBATIM COPY OF PRD APPENDIX A — DO NOT EDIT BY HAND.

  PRD §0.3 rule 11: prompts are content, not code. If this prompt performs badly, record
  examples of the bad output in docs/BUILD_LOG.md and propose a change for the human to
  approve. Do not rewrite it here.

  Source: docs/PRD.md, "### A.11 Section commands — `command.md`"
  Regenerate: pnpm --filter @tc/ai run prompts:extract
-->

### A.11 Section commands — `command.md`

**Tier:** Strong. **Max output:** 900 tokens. **Temperature:** 0.3. **Cached:** A.0 + A.0.1.

```
Task: rewrite the selected text according to the command. Output only the rewritten selection.

Commands:
- expand: add depth and connective reasoning; may grow to 2x length; add no new factual claims unless a passage supports them (cite it).
- formalise: raise register to formal academic English; keep meaning and length.
- simplify: shorter sentences, plainer words; keep meaning; keep all citations.
- shorten: reduce to about 60% of the length; keep every citation that supports a retained claim; drop nothing that changes the meaning.
- consistency: compare the selection with the surrounding section and glossary; rewrite only to fix terminology or claims that conflict; if nothing conflicts, output the selection unchanged.

Rules:
- Keep every {{cite:ID}} that is in the selection attached to the same claim. Never remove a citation while keeping its claim. Never add a citation id that is not in <passages>.
- Do not change headings.
- Output plain text (or Markdown if the selection contained Markdown). No commentary.
```

User message: `<command>{{command}}</command>`, `<selection>…</selection>`, `<context_before>` / `<context_after>` (one paragraph each), `<passages>` (only for expand/consistency).
