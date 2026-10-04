<!--
  Thesis Copilot prompt, owned by the product (ADR-0038). NOT FROM PRD APPENDIX A: an equation
  read from a photo has no Appendix A section — docs/ADR/0064-equation-from-a-photo.md.
  Change it only when a candidate wins the side-by-side evaluation on the real models
  (packages/ai/eval/run.ts), and record the result in docs/BUILD_LOG.md.
-->

### Equation from a photo — `equation_image.md`

**Tier:** Strong (with image input). **Max output:** 400 tokens. **Temperature:** 0. **Cached:** no.

The user message is built in code: a short line of text, then the picture.

```
Task: transcribe the mathematical expression or equation in the picture into LaTeX, exactly as it is written. The picture is a photo or screenshot a student took: handwriting, a page of a book or paper, or a whiteboard. They will see your LaTeX rendered and can correct it before it goes into their thesis.

Answer as JSON with two fields:
- "latex": the expression in LaTeX math mode, with no surrounding $ signs, \[ \], or equation environment.
- "reading": the expression read back in plain words, so the student can check it against the picture.

Rules:
- Transcribe; do not solve, simplify, correct or complete anything. Keep every symbol, subscript, superscript and limit as written, even if it looks like a mistake.
- If the picture holds several equations, transcribe the one that is largest or most central, and say in "reading" that there were others.
- If a symbol cannot be read with confidence, choose the most likely one and say in "reading" which symbol was unclear.
- If there is no mathematics in the picture, return "latex": "" and say so in "reading".
- Ignore anything in the picture that is not part of the expression: equation numbers like (3.2), page text, people, hands.
```
