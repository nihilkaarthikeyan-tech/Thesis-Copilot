/**
 * The time limit every model call carries (ADR-0145 addendum, 2026-10-10).
 *
 * "No model call without a time limit" was a rule each call site had to remember, and sixteen
 * files did not: an outline scope, the style profile, cite, proofread, comments, viva, coherence,
 * cross-paper and draft-section all passed no signal, so one call OpenAI never answered held a
 * request or a job open for good. The adapters now add this ceiling to whatever the caller passed.
 *
 * It is a backstop, not a budget: every explicit limit in the product is shorter (the longest,
 * a chapter-build call, is 180 s), so the caller's own signal still decides in every case it
 * already did. A call that reaches the ceiling fails like any other provider error.
 */
export const MODEL_CALL_CEILING_MS = 240_000;

/** The caller's signal, if any, together with the ceiling: whichever fires first aborts the call. */
export function callSignal(
  signal: AbortSignal | undefined,
  ceilingMs: number = MODEL_CALL_CEILING_MS,
): AbortSignal {
  const ceiling = AbortSignal.timeout(ceilingMs);
  return signal ? AbortSignal.any([signal, ceiling]) : ceiling;
}
