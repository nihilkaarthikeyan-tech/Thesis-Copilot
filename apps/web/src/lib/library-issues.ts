/**
 * What a merge of two duplicate sources did, said so the student can check it against their
 * chapters (2026-10-04; the screen is `app/d/[id]/sources/DuplicatesPanel.tsx`).
 */

export type MergeResult = {
  citationsMoved: number;
  passagesCleared: number;
  pinsMoved: number;
  fileMoved: boolean;
};

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What the merge did, in one sentence the student can check against their chapters. */
export function mergeSummary(result: MergeResult): string {
  const parts: string[] = [];
  if (result.citationsMoved > 0) {
    parts.push(
      `${plural(result.citationsMoved, 'citation now points', 'citations now point')} at the kept copy`,
    );
  }
  if (result.pinsMoved > 0)
    parts.push(`${plural(result.pinsMoved, 'chapter pin', 'chapter pins')} moved`);
  if (result.fileMoved) parts.push('its PDF moved across and is being read');
  const head =
    parts.length > 0 ? `Merged: ${parts.join(', ')}.` : 'Merged. Nothing cited the copy.';
  const tail =
    result.passagesCleared > 0
      ? ` ${plural(result.passagesCleared, 'citation no longer opens', 'citations no longer open')} at a passage, because the kept copy does not have the same text; the citation itself is unchanged. The chapter before the merge is in History.`
      : result.citationsMoved > 0
        ? ' The chapter before the merge is in History.'
        : '';
  return head + tail;
}
