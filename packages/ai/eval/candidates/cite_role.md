<!--
  CANDIDATE for cite_role.md (ADR-0038). Tested against the prompt on disk by eval/score.ts; it replaces
  it only if it wins.
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
- For the narrative form, put the target citation at or near the start of the sentence as its subject, followed by a reporting verb that matches the claim's strength ("found", "reported", "showed", "suggested"), then the claim. Drop an opening connective such as "However" only if keeping it would make the sentence ungrammatical.
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
