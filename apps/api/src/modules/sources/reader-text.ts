/**
 * The text of a paper for the reader's Text view (ADR-0068).
 *
 * What we hold of a paper's words is its `SourceChunk` rows, and they overlap: the chunker steps
 * back ~15% at each boundary so a retrieved passage keeps its context (FR-2.4). Shown one after
 * another they would repeat a sentence or two at every join. Each chunk records where it sits in
 * the extracted text (`charStart`/`charEnd`), so the overlap can be cut off exactly: a chunk
 * contributes only what lies past the end of the one before it.
 *
 * A chunk without offsets (an abstract, an older row) is shown whole — there is nothing to measure
 * the overlap against, and repeating a sentence is better than dropping one.
 */

export type ChunkRow = {
  id: string;
  ordinal: number;
  page: number | null;
  section: string | null;
  text: string;
  charStart: number | null;
  charEnd: number | null;
};

export type ReaderPassage = {
  /** The chunk the passage comes from — the id a citation's `chunkId` names. */
  id: string;
  page: number | null;
  section: string | null;
  text: string;
};

export function readerPassages(rows: readonly ChunkRow[]): ReaderPassage[] {
  const ordered = [...rows].sort((a, b) => a.ordinal - b.ordinal);
  const passages: ReaderPassage[] = [];
  let reached: number | null = null;

  for (const row of ordered) {
    let text = row.text;
    if (row.charStart !== null && row.charEnd !== null && reached !== null) {
      if (row.charEnd <= reached) continue; // wholly inside what is already shown
      if (row.charStart < reached) text = row.text.slice(reached - row.charStart);
    }
    if (row.charEnd !== null) reached = Math.max(reached ?? 0, row.charEnd);
    const trimmed = text.trim();
    if (!trimmed) continue;
    passages.push({ id: row.id, page: row.page, section: row.section, text: trimmed });
  }
  return passages;
}
