# 0064 — An equation read from a photo

Date: 2026-10-04
Status: accepted
Follows: ADR-0059 (row 71) and ADR-0063 (the words version, whose checks this shares).

## Context

A student has the equation in a book, on a whiteboard or in their notebook and cannot type it in
LaTeX. Jenni reads it from a picture. Doing so needs image input — a capability no call in this
product had used — and a prompt Appendix A does not have.

## Decision

- `Message` in `packages/ai` may carry images; every adapter sends them after the text as `file`
  parts with an image media type (the SDK's `image` part is deprecated in AI SDK 7). OpenAI
  receives them as `input_image` data URLs — asserted on the wire body in `openai.spec.ts`, per the
  rule that an adapter is only proven by what it sends. The Anthropic adapter maps the same way;
  no configured model routes to it today (ADR-0011).
- A new prompt, `packages/ai/prompts/equation_image.md`, NOT FROM PRD APPENDIX A: transcribe,
  don't solve or correct; say which symbol was unclear; ignore equation numbers and page text.
- `POST /equations/from-photo?documentId=` (multipart, one picture). The type is sniffed from the
  bytes (PNG, JPEG, WebP), 4 MB cap; the browser shrinks a phone photo to 1,600 px before sending.
  One **COMMAND** unit, refunded when the provider fails or the LaTeX does not render. The same
  KaTeX check, read-back and Apply as ADR-0063: nothing enters the thesis on its own.
- The picture is not stored: it lives for the length of the request.

## Evaluation (2026-10-04, gpt-5-mini)

`packages/ai/scripts/eval-equation-image.ts` over 8 equations typeset with KaTeX and screenshotted
(regression, mean, Gibbs energy, an integral, efficiency, variance, the heat equation, R²):
**8 of 8** matched once compared as rendered MathML. About 570 tokens per picture (≈ ₹0.05).
Not yet evaluated: handwriting and real phone photos — no such images exist in the repo and the
agent will not fabricate them; listed in docs/PENDING.md for a person to try a few.

## Cost

Within the COMMAND allowance; caps unchanged.
