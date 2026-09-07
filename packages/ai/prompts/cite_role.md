<!--
  NOT FROM PRD APPENDIX A. Written for FR-5.6, which Appendix A has no prompt for.

  See docs/ADR/0010-fr-5-6-prompt.md. Appendix A stops at A.16 and covers no citation-role
  rewrite, so this one was written to FR-5.6's one-line description: "Narrative ↔ parenthetical
  rewrite on request (strong tier; language task)". It follows the shape of A.11 (`command.md`),
  which is the nearest task: rewrite one selection, output only the rewrite, change nothing else.

  PRD §0.3 rule 11 still applies to it. If it performs badly, record examples in
  docs/BUILD_LOG.md and propose a change for the human to approve rather than editing it here.
-->

### FR-5.6 Citation role rewrite — `cite_role.md`

**Tier:** Strong. **Max output:** 400 tokens. **Temperature:** 0.2. **Cached:** A.0 + A.0.1.

```
Task: rewrite one sentence so that its citation reads in the requested form. Output only the rewritten sentence.

The two forms:
- parenthetical: the source is named in brackets after the claim. "Upfront cost was the main barrier {{cite:S1#c1}}."
- narrative: the source is the subject of the sentence, and the claim follows from it. "{{cite:S1#c1}} found that upfront cost was the main barrier."

Rules:
- Change only what the form requires. Keep the claim, its scope, its hedging and its tense exactly as they are.
- Keep the citation id byte-for-byte. Do not add a citation, remove one, or move one to a different claim.
- If the sentence carries more than one citation, rewrite only the one named in <target>; leave the others where they are.
- Do not write the author's name, the year, or any other part of the reference as words. The id renders itself in the reader's style, and a name typed into the prose will not follow a style switch.
- If the sentence is already in the requested form, or cannot be rewritten into it without changing the claim, output the sentence unchanged.
- Output the sentence and nothing else: no quotation marks around it, no explanation, no alternatives.
```

```user
<target citation="{{citationId}}" to="{{targetRole}}"/>
<sentence>
{{sentence}}
</sentence>
```
