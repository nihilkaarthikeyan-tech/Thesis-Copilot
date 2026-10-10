/**
 * Where a citation marker sits in a suggestion (ADR-0150, from the side-by-side of 2026-10-10).
 *
 * Two faults seen in live suggestions, both fixed here in code and not in the prompt:
 *
 *   - "…rural households in Karnataka. {{cite:S1#c1}}" — the marker after the full stop, so the
 *     sentence read "Karnataka. (Mutumbi 2024)". A citation belongs inside the sentence it
 *     supports: "…in Karnataka {{cite:S1#c1}}."
 *   - "…interventions {{cite:S1#c1}}. These barriers … income groups {{cite:S1#c1}}." — one paper
 *     cited twice in one two-sentence suggestion. The second marker stays and the first goes: a
 *     citation at the end of the passage covers what precedes it, and the student is not shown
 *     the same key twice in one offer.
 *
 * Kept apart from `postprocess.ts`'s own steps and from any punctuation pass: these two functions
 * touch only `{{cite:…}}` markers and the terminator next to them.
 */

const MARKER = /\{\{cite:[^}]+\}\}/g;

/**
 * A run of markers that follows a sentence terminator (and any closing quote or bracket), with
 * only spaces between: `. {{cite:A}}`, `.{{cite:A}} {{cite:B}}`, `?" {{cite:A}}`.
 */
const AFTER_STOP =
  /([.!?])(["'”’)\]]*)([ \t]*)((?:\{\{cite:[^}]+\}\}[ \t]*)*\{\{cite:[^}]+\}\})(?=\s*$|\s*[.!?]|\s+[\p{Lu}\p{N}"“([])/gu;

/**
 * Moves a marker run that sits just after a sentence's full stop to just before it:
 * "Karnataka. {{cite:X}}" → "Karnataka {{cite:X}}." The closing quote or bracket stays with the
 * sentence; a run already inside the sentence is left alone.
 */
export function moveTrailingCitationsInside(text: string): string {
  return text.replace(AFTER_STOP, (_whole, stop: string, close: string, _gap, run: string) => {
    const markers = run.match(MARKER) ?? [];
    return ` ${markers.join('')}${close}${stop}`;
  });
}

/** The paper a marker cites: `S3` of `{{cite:S3#c2}}`. Two chunks of one paper are one label. */
const sourceOf = (marker: string): string =>
  (/\{\{cite:\s*([^#}\s]+)/.exec(marker)?.[1] ?? marker).trim();

/**
 * One marker per paper within a suggestion. Two passages of one paper carry different keys but
 * render as one label, and "(Mutumbi 2024) … (Mutumbi 2024)" in a two-sentence offer is what the
 * student saw. When a paper appears again later, the later marker is kept and the earlier removed,
 * so the citation covers the whole passage it supports. The space the removed marker leaves is
 * tidied; the sentence's own punctuation is not touched.
 */
export function dedupeCitationKeys(text: string): string {
  const last = new Map<string, number>();
  let count = 0;
  for (const match of text.matchAll(MARKER)) {
    last.set(sourceOf(match[0]), count);
    count++;
  }
  if (last.size === count) return text;
  let index = 0;
  const kept = text.replace(/[ \t]*\{\{cite:[^}]+\}\}/g, (withSpace) => {
    const marker = withSpace.trimStart();
    return last.get(sourceOf(marker)) === index++ ? withSpace : '';
  });
  return kept.replace(/[ \t]+([.,;:!?])/g, '$1').replace(/[ \t]{2,}/g, ' ');
}

/** Both, in the order they are meant to run: placement first, so a moved marker can be deduped. */
export function placeCitations(text: string): string {
  return dedupeCitationKeys(moveTrailingCitationsInside(text));
}
