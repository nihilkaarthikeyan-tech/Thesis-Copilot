/**
 * Token estimation for prompt budgets — PRD §10.3 and PHASES 3.2.
 *
 *   "token counting via the provider's tokenizer or a calibrated estimator (state which, and the
 *    calibration in the log)"
 *
 * This is the estimator, not the tokenizer. The Anthropic SDK exposes no offline tokenizer, and
 * the count-tokens endpoint is a network call that would cost more latency than the budget check
 * is worth on every Assist request.
 *
 * Calibration: the ratio below is PRD §11.1's own assumption (≈ 4 characters per token), which is
 * also what the cost model was priced on, so the budget check and the budget agree with each
 * other. It has NOT been calibrated against the real tokenizer — that needs `pnpm ai:verify`
 * and a provider key (docs/PENDING.md). English academic prose typically runs 4.0–4.5 characters
 * per token on modern tokenizers, so this over-estimates slightly and trims a little early, which
 * is the safe direction for a cache budget.
 */

export const CHARS_PER_TOKEN = 4;

export function approxTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Keeps roughly the last `tokens` worth of text, cut at a word boundary. */
export function tailByTokens(text: string, tokens: number): string {
  const maxChars = tokens * CHARS_PER_TOKEN;
  if (text.length <= maxChars) return text;
  const cut = text.slice(text.length - maxChars);
  const firstSpace = cut.search(/\s/);
  return firstSpace === -1 ? cut : cut.slice(firstSpace + 1);
}

/** Keeps roughly the first `tokens` worth of text, cut at a word boundary. */
export function headByTokens(text: string, tokens: number): string {
  const maxChars = tokens * CHARS_PER_TOKEN;
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.search(/\s\S*$/);
  return lastSpace === -1 ? cut : cut.slice(0, lastSpace);
}
