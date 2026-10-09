/**
 * "Search the literature" on an AI edit (ADR-0133) — the screen's side, with no DOM.
 *
 * The switch sits beside "Use my library" in the edit panel. When on, the edits that can use
 * passages (your own instruction, Expand, Check consistency, Counter-argument) ask the server to
 * search the indexes and add the few papers on topic to the library before the edit is written;
 * the result lists them, each opening in the reader. Nothing enters the thesis until Replace or
 * Insert below, as before.
 */

/** The edits the switch applies to; the server ignores it for the others. */
export const LITERATURE_COMMANDS: readonly string[] = [
  'custom',
  'expand',
  'consistency',
  'counter',
];

export function literatureApplies(command: string): boolean {
  return LITERATURE_COMMANDS.includes(command);
}

export type CommandRunBody = {
  chapterId: string;
  command: string;
  selection: string;
  contextBefore: string;
  contextAfter: string;
  instruction?: string;
  useLibrary?: boolean;
  original?: string;
  searchLiterature?: true;
};

/**
 * What `POST /commands/run` is sent. The switch implies the library (what it finds is added
 * there). A follow-up refines a version already written from those papers, which are in the
 * library by then, so it does not search again.
 */
export function commandRunBody(input: {
  chapterId: string;
  command: string;
  selection: string;
  contextBefore: string;
  contextAfter: string;
  instruction?: string;
  useLibrary: boolean;
  searchLiterature: boolean;
  /** The student's own text, for a follow-up; absent otherwise. */
  original?: string;
}): CommandRunBody {
  const searching = input.searchLiterature && literatureApplies(input.command) && !input.original;
  return {
    chapterId: input.chapterId,
    command: input.command,
    selection: input.selection,
    contextBefore: input.contextBefore,
    contextAfter: input.contextAfter,
    ...(input.instruction
      ? { instruction: input.instruction, useLibrary: input.useLibrary || input.searchLiterature }
      : {}),
    ...(input.original ? { original: input.original } : {}),
    ...(searching ? { searchLiterature: true as const } : {}),
  };
}

/** One paper an edit added, as the server reports it. */
export type AddedPaper = {
  sourceId: string;
  shortRef: string;
  title: string;
  year: number | null;
};

export type EditLiterature = {
  added: AddedPaper[];
  collection: { id: string; name: string } | null;
  note: string | null;
};

/** The heading of the added list: "Added to your library" (and the collection, when filed). */
export function addedHeading(literature: EditLiterature): string {
  const n = literature.added.length;
  const into = literature.collection ? ` (in ${literature.collection.name})` : '';
  return `Added to your library${into}${n > 1 ? ` — ${n} papers` : ''}:`;
}
