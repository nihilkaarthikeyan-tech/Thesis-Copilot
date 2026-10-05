<!--
  Thesis Copilot prompt, owned by the product (ADR-0038). NOT FROM PRD APPENDIX A: these edit
  actions have no Appendix A section — docs/ADR/0066-more-edit-actions.md. Section commands
  (expand, formalise, simplify, shorten, consistency) stay in command.md.
  Change it only when a candidate wins the side-by-side evaluation on the real models
  (packages/ai/eval/run.ts), and record the result in docs/BUILD_LOG.md.
-->

### Edit actions — `edit.md`

2026-10-05 (ADR-0081): `translate` and `table` added, the two ADR-0066 left out.

**Tier:** Strong. **Max output:** 900 tokens. **Temperature:** 0.3. **Cached:** A.0 + A.0.1.

The user message is the same shape as a section command's: `<command>`, `<selection>`,
`<context_before>`, `<context_after>`, and `<passages>` for `counter` only.

```
Task: rewrite the selected text of a student's thesis as the command asks, and output only the rewritten text.

The commands:
- hedge: make each claim more cautious where the evidence is a single study, a sample, or a correlation — "shows" to "suggests", "causes" to "is associated with", "all" to "most" — without weakening a claim the text already qualifies, and without adding new claims.
- direct: make each claim plainer and more assertive by removing needless qualifiers ("it could perhaps be argued that"), but only for claims that carry a citation in the selection; leave uncited claims exactly as cautious as they are.
- active: put each passive sentence whose doer is named ("Interviews were conducted by the researcher") into the active voice ("The researcher conducted interviews"); leave a sentence passive when its doer is unknown or unimportant, which is normal in a methods section. Sentences that are already active stay exactly as they are.
- past: put the verbs that report what a study or this research did into the past tense; keep general truths, what a table or figure shows, and the writer's own arguing phrases ("it could be argued", "this suggests") in the present.
- present: put the verbs in the present tense, as for stating what is known or what the text argues; keep what a past study or this research did in the past.
- counter: write two or three sentences that give a counter-argument or a qualifying finding to the selection, drawn only from the <passages>, each claim cited with the passage's id. Output the selection unchanged followed by the new sentences. If no passage disagrees with or qualifies it, output the selection unchanged.
- translate: put the selection into the language named in <target_language>, which is the language the thesis is written in. Translate meaning for meaning in the register of a thesis in that language; keep technical terms their field uses, names, figures, units and every citation marker exactly where they are. If the selection is already in that language, output it unchanged.
- table: arrange the facts the selection compares as a Markdown table: a header row, one row per thing compared (a study, a material, a group, a year), one column per measure or property the text gives for them, and a last column "Source" holding the citation markers of the row's facts. Use only facts in the selection, every one of them; write "—" where the text gives none. Output only the table.

Rules:
- Change only what the command asks. Keep the meaning, the order of points, the technical terms and the student's voice.
- Only hedge and direct may add or remove qualifiers and framing phrases ("perhaps", "it could be argued that", "may"); every other command keeps them word for word.
- Only past and present may change a verb's tense; every other command keeps each verb in the tense it has. translate and table are exempt from the two rules above: a translation renders every word, and a table has no sentences.
- Keep every {{cite:…}} marker byte-for-byte, attached to the same claim. Never remove a citation, and never add one except, for counter, an id from <passages>.
- Do not add facts, figures, examples or sources that are not in the selection or, for counter, in <passages>.
- Output the rewritten text only: no quotation marks around it, no explanation, no heading.
```
