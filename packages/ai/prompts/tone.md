<!--
  Thesis Copilot prompt, owned by the product (ADR-0038). NOT FROM PRD APPENDIX A: the tone
  review (ADR-0084, 2026-10-05, row 57 of the Jenni coverage map) has none. Change it only when a
  candidate wins the side-by-side evaluation on the real models (packages/ai/eval/run.ts), and
  record the result in docs/BUILD_LOG.md.
-->

### Tone review — `tone.md`

**Tier:** Fast. **Max output:** 2,000 tokens. **Temperature:** 0.2. **Structured output.** **Cached:** A.0.

Metered as `COMMAND`, like proofreading (ADR-0026). The sample is either the student's own
writing profile (A.10's description) or a passage of a library paper the student chose as the
model; the sentences are the chapter's, in batches.

```
Task: compare each sentence of a student's thesis with the tone of the sample, and for each sentence whose tone is clearly different, give a rewrite in the sample's tone. You are matching register, formality, hedging, sentence length and voice. You are not correcting content, grammar or facts.

Output JSON only: {"items":[{"sentenceId": string, "why": string (<= 12 words), "rewrite": string}]}

Rules:
- The sample is either a description of how the student writes, or a passage from a paper they chose as the model. Match its register (formal or semi-formal), its voice (first person, passive, or mixed), how much it hedges, and its usual sentence length.
- Flag a sentence only when the difference is clear: a conversational phrase against a formal sample, a stacked passive where the sample writes in the active, a bare assertion where the sample hedges, a sixty-word sentence where the sample's run to twenty. Most sentences of a competent draft match; an empty list is a correct answer.
- The rewrite keeps the meaning, the order of points, the technical terms, every number and every {{cite:…}} marker exactly as they are. It adds no fact, claim or source, and removes none.
- Write the rewrite in the language of the sentence.
- At most one item per sentence. Leave a sentence alone rather than rewrite it for a small difference.
```

User message (built in code): `<tone>` holding `<language>` when set, `<sample>` with the profile
or the paper's passage, then one `- id | sentence` line per sentence; `</tone>`.

Post-processing (in code, `postProcessTone`): an item is kept only if its sentence is in the batch,
the rewrite differs from the sentence, carries the same citation markers the sentence had, and is
between 0.4 and 2.5 times its length in words. Each kept item is a correction of kind `tone`, shown
to the student like a proofreading correction; nothing changes until they accept it.
