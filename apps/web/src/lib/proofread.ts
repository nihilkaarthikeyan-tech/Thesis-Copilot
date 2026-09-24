/**
 * Placing a proofreading correction in the chapter as it is now — ADR-0026.
 *
 * The server read the chapter a moment ago; the student may have typed since. So a correction is
 * not applied at a stored position. It is found: the span it corrects, in the current text,
 * nearest to where the sentence was when it was read. A span that is no longer there is not
 * applied — "the text has changed" is the honest answer, and a guess could edit the wrong words.
 *
 * The chapter is read as runs of text with their positions. Anything that is not text — a
 * citation, an equation — and every gap between runs (a paragraph break) becomes a separator that
 * no span can contain, so a correction can never swallow a citation or reach across paragraphs.
 */

/** A run of text at a document position, as `doc.descendants` yields text nodes. */
export type TextRun = { pos: number; text: string };

const SEPARATOR = String.fromCharCode(0);

/** Where `needle` is in the runs, nearest to `near`; null when it is not there at all. */
export function locateSpan(
  runs: readonly TextRun[],
  needle: string,
  near: number,
): { from: number; to: number } | null {
  if (!needle) return null;
  let text = '';
  const positions: number[] = [];
  let end = -1;
  for (const run of runs) {
    if (end !== -1 && run.pos !== end) {
      text += SEPARATOR;
      positions.push(-1);
    }
    for (let i = 0; i < run.text.length; i++) {
      text += run.text[i];
      positions.push(run.pos + i);
    }
    end = run.pos + run.text.length;
  }

  let best: { from: number; to: number } | null = null;
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
    const from = positions[at] ?? -1;
    const last = positions[at + needle.length - 1] ?? -1;
    if (from === -1 || last === -1) continue;
    const span = { from, to: last + 1 };
    if (!best || Math.abs(span.from - near) < Math.abs(best.from - near)) best = span;
  }
  return best;
}
