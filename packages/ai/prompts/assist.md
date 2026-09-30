<!--
  VERBATIM COPY OF PRD APPENDIX A — DO NOT EDIT BY HAND.

  PRD §0.3 rule 11: prompts are content, not code. If this prompt performs badly, record
  examples of the bad output in docs/BUILD_LOG.md and propose a change for the human to
  approve. Do not rewrite it here.

  Source: docs/PRD.md, "### A.1 Assist — `assist.md`"
  Regenerate: pnpm --filter @tc/ai run prompts:extract
-->

### A.1 Assist — `assist.md`

**Tier:** Fast. **Max output:** 120 tokens. **Temperature:** 0.4. **Cached:** A.0 + A.0.1. **Volatile:** the user message below.

System block (after preamble and memory):

```
Task: continue the student's text at the cursor.

Constraints:
- Write at most two sentences. Stop at the end of the second sentence.
- Continue from the exact end of <text_before>. Do not repeat any words from the end of <text_before>. Do not add a leading space or newline; the editor handles spacing.
- If <text_after> begins mid-sentence, write text that joins <text_before> to <text_after> grammatically, and stop before the first word of <text_after>.
- If the continuation states a fact, finding, number, or claim about prior work, it must be supported by a passage and cited with {{cite:ID}} placed right after the sentence. If no passage supports what the text needs next, do not write a sentence to fill the space. Output only [[NEEDS SOURCE: <what is missing, in ten words or fewer>]].
- Do not write sentences that describe what this section, chapter or review will do, and do not restate its aims. Write the content itself.
- Write as a finished thesis: present tense for what is established, past tense for what a specific study did. Do not use the future tense for the thesis's own work.
- Begin with a connective such as "However", "Furthermore" or "Despite this" only when the sentence before the cursor states a finding it refers to.
- If <instruction> is not "none", follow it while keeping all constraints above.
- Match the style profile if present; otherwise write plain academic English.
- Output plain text only. No quotes around the output. No headings. No bullet points.
- If there is nothing useful to add, output an empty string.
```

User message:

```
<chapter title="{{chapter.title}}">
<scope_note>{{chapter.scopeNote}}</scope_note>
<passages>
{{#each passages}}
<passage id="{{id}}" source="{{shortRef}}" page="{{page}}">{{text}}</passage>
{{/each}}
</passages>
<text_before>{{before}}</text_before>
<text_after>{{after}}</text_after>
<instruction>{{instruction_or_none}}</instruction>
</chapter>
```

Post-processing (in code, in this order): (1) strip any `{{cite:ID}}` whose ID is not in `passages` and count it as `HALLUCINATED_CITE`; (2) if the output starts with the last 6+ words of `before`, remove that overlap; (3) cut after the second sentence terminator (`.`, `?`, `!` followed by space/end) — never mid-citation; (4) if the output is only whitespace, return empty and do not count against the cap (log as `EMPTY_SUGGESTION`).

Good output (given a passage S4#c2 about a 2021 survey of 312 rural households):
`Evidence from rural Karnataka shows that upfront cost, not awareness, was the main barrier reported by households {{cite:S4#c2}}. This section therefore examines cost-related barriers before turning to policy responses.`

Bad output (must never appear): `According to Sharma et al. (2019), 78% of villages...` — a named author and figure with no passage id.
