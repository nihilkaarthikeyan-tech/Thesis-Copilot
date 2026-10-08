/**
 * The `@` citation picker's trigger (2026-09-21), apart from the component so it can be tested.
 */

/** How far back from the caret an `@query` may run before it stops being one. */
export const MAX_QUERY = 40;

/**
 * The `@…` the caret currently sits at the end of, if any.
 *
 * Requires whitespace (or the start of the block) before the `@`, so an email address in the
 * student's own prose does not open a citation picker halfway through it — or a citation
 * (`{{cite:…}}` in the editor's text), so a second source can be added right beside the first
 * and the two read as one bracket (R40, ADR-0117).
 */
export function activeMention(textBefore: string): string | null {
  const at = textBefore.lastIndexOf('@');
  if (at === -1) return null;
  const query = textBefore.slice(at + 1);
  if (query.length > MAX_QUERY || /[\n\r]/.test(query)) return null;
  const before = at === 0 ? '' : textBefore[at - 1];
  const afterCitation = /\{\{cite:[^}]+\}\}$/.test(textBefore.slice(0, at));
  if (before !== '' && before !== undefined && !/\s|[([]/.test(before) && !afterCitation) {
    return null;
  }
  return query;
}
