# ADR-0048 — Keep what a cut-off structured answer finished

**Status:** accepted · **Date:** 2026-10-03 · **Builds on:** ADR-0011 (OpenAI adapter), the
reasoning-headroom rule in the project brief.

## Context

From the Rademics Copilot comparison: it repairs model JSON that was cut off by the output limit
by balancing braces and closing open strings. We had rated this low, because strict structured
outputs make malformed JSON rare. But strict outputs do not stop a *truncated* answer: when a
reasoning model spends its budget, the JSON stops mid-array and `generateObject` throws. The
whole call failed — every theme, proofreading correction or examiner issue the model had finished
was thrown away with the one it had not, and the student was charged nothing but got nothing. The
adapter also kept the error message rather than the model's text, so the log could not say what
had come back.

## Decision

- `repairTruncatedJson` (`packages/ai/src/providers/json-repair.ts`) cuts back to the last value
  the model **completed** and closes the brackets around it. It never closes an open string:
  that would keep a value the model did not finish ("Cost barr", "The results show that"). A cut
  that leaves nothing complete is not repaired, and the call fails as before.
- It is plugged into the AI SDK's own `repairText` hook (checked in `ai@7.0.92`'s types), which
  runs only when the text fails to parse; a well-formed answer that fails the schema is never
  touched. The repaired object still goes through the Zod schema like any other.
- `LlmResult.truncatedRepaired` is set when it happened, so a caller that needs a complete list
  can refuse a partial one. A failed parse now carries the model's text (first 4,000 characters)
  in `LlmValidationError.raw`.

## Consequences

- A cut-off answer that has useful finished items is used instead of wasted. The usage is the
  same either way — the tokens were spent — so nothing changes in metering.
- The Anthropic adapter is not changed: no configured model routes to it (ADR-0011, the owner's
  instruction). If it is used again it should get the same hook.
- None of the current callers needs a complete list to be correct: themes put unplaced candidates
  in "Other", proofreading and the examiner report what they found. A future caller for which a
  partial list is wrong must check `truncatedRepaired`.
