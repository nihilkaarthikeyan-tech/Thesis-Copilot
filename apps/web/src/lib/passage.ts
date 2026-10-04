/**
 * The matching passage under a "Find papers" result (coverage-map row 23).
 *
 * The API chooses the passage and marks the query's words in it (`matchingPassage` in
 * `@tc/retrieval`); this only cuts the text into plain and marked runs for display. It never adds
 * or changes a character: joined back together, the runs are the passage.
 */

export type MatchedPassage = {
  text: string;
  highlights: ReadonlyArray<{ start: number; end: number }>;
  clippedStart: boolean;
  clippedEnd: boolean;
};

export type PassageRun = { text: string; match: boolean };

export function passageRuns(passage: Pick<MatchedPassage, 'text' | 'highlights'>): PassageRun[] {
  const runs: PassageRun[] = [];
  let at = 0;
  const ordered = [...passage.highlights].sort((a, b) => a.start - b.start);
  for (const { start, end } of ordered) {
    // A range that is out of bounds or overlaps the previous one is ignored, not trusted.
    if (start < at || end <= start || end > passage.text.length) continue;
    if (start > at) runs.push({ text: passage.text.slice(at, start), match: false });
    runs.push({ text: passage.text.slice(start, end), match: true });
    at = end;
  }
  if (at < passage.text.length) runs.push({ text: passage.text.slice(at), match: false });
  return runs;
}
