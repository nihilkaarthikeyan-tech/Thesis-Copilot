/**
 * ADR-0078: a paper's "this study" about itself, renamed before the passage reaches the model.
 *
 * In a thesis, "this study" means the student's own work. Full-text passages say it about their
 * own paper (12% of the Karnataka library's chunks), and the model carried the phrase into the
 * thesis: "the household-friction framework used in this study" about Bagla 2026, read by an
 * examiner as the student's framework. Two prompt rules that named the fault cut it but made the
 * drafts copy more of the papers' wording (`docs/BUILD_LOG.md`, ADR-0078), so the phrase is
 * renamed in code instead: the model never sees it, and nothing about the wording changes.
 *
 * Only the passage the model reads changes. Grounding, the citation-support check and the
 * copy check all compare against the stored text.
 */

const OWN_WORK =
  /\b(this|the present|the current|our)\s+(study|paper|article|research|investigation|work|review)\b/gi;

export function nameTheSource(text: string, shortRef: string): string {
  const name = shortRef.trim();
  if (!name) return text;
  return text.replace(OWN_WORK, (match: string, _which: string, noun: string) => {
    const the = match[0] === match[0]?.toUpperCase() ? 'The' : 'the';
    return `${the} ${noun.toLowerCase()} by ${name}`;
  });
}
