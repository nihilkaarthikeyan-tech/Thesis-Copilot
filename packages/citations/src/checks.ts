/**
 * Mechanical citation checks — PRD FR-5.4, PHASES v2 W10.3.
 *
 *   "Mechanical checks (no LLM): orphan in-text citations, unused bibliography entries, untagged
 *    citation-like strings in body (regex)."
 *
 * No model is involved, so nothing here can hallucinate a problem: every finding points at a node
 * position, a source id, or a span of the student's own text. The same functions serve the P2
 * list on `/citations` and, from Phase 3, the coherence sidebar.
 */

export type CitationCheckKind = 'ORPHAN' | 'UNUSED' | 'UNTAGGED';

export type CitationFinding = {
  kind: CitationCheckKind;
  /** One sentence, addressed to the student. */
  message: string;
  chapterId?: string;
  chapterTitle?: string;
  /** ProseMirror position of the node or the matched text, when there is one. */
  from?: number;
  to?: number;
  sourceId?: string;
  nodeKey?: string;
  /** The matched string, for UNTAGGED. */
  text?: string;
};

export type ChapterDoc = {
  id: string;
  title: string;
  /** ProseMirror JSON. */
  content: unknown;
};

type Node = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: Node[];
};

export type FoundCitationNode = {
  chapterId: string;
  chapterTitle: string;
  nodeKey: string;
  sourceId: string;
  from: number;
  to: number;
};

/**
 * Every `citation` node in a chapter, with its ProseMirror position.
 *
 * Positions follow ProseMirror's own accounting: a text node advances by its length, every other
 * node by 1 plus the size of its content (the two token positions of the open and close tags).
 * An inline atom like `citation` has size 1.
 */
export function citationNodesIn(chapter: ChapterDoc): FoundCitationNode[] {
  const out: FoundCitationNode[] = [];
  const walk = (node: Node | undefined, pos: number): number => {
    if (!node) return pos;
    if (node.type === 'text') return pos + (node.text?.length ?? 0);
    if (node.type === 'citation') {
      const key = String(node.attrs?.key ?? '');
      const sourceId = String(node.attrs?.sourceId ?? '');
      if (key) {
        out.push({
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          nodeKey: key,
          sourceId,
          from: pos,
          to: pos + 1,
        });
      }
      return pos + 1;
    }
    let inner = pos + 1;
    for (const child of node.content ?? []) inner = walk(child, inner);
    return inner + 1;
  };
  // The doc node itself occupies no position; its children start at 0.
  let pos = 0;
  for (const child of (chapter.content as Node | undefined)?.content ?? []) pos = walk(child, pos);
  return out;
}

/**
 * Citation-like strings the student typed rather than inserted: "(Kumar, 2021)", "(Kumar et al.,
 * 2021)", "[12]", "Kumar (2021)". Deliberately narrow — a false positive costs the student a
 * moment of doubt about text that is fine, which is worse than missing one.
 */
const UNTAGGED_PATTERNS: ReadonlyArray<{ re: RegExp; why: string }> = [
  {
    // (Kumar, 2021) · (Kumar & Rao, 2019) · (Kumar et al., 2021, p. 4)
    re: /\((?:[A-Z][\p{L}'’-]+(?:,? (?:and |& )?[A-Z][\p{L}'’-]+| et al\.)?),? (?:19|20)\d{2}(?:, [^)]{1,20})?\)/gu,
    why: 'looks like an author–date citation',
  },
  {
    // Kumar (2021) · Kumar and Rao (2019) · Kumar et al. (2021)
    re: /\b[A-Z][\p{L}'’-]+(?: (?:and|&) [A-Z][\p{L}'’-]+| et al\.)? \((?:19|20)\d{2}\)/gu,
    why: 'looks like a narrative citation',
  },
  {
    // [12] or [3], [4] — a numeric marker typed by hand.
    re: /\[\d{1,3}(?:\s*[,–-]\s*\d{1,3})*\]/g,
    why: 'looks like a numeric citation marker',
  },
];

/** Plain text of a chapter, with the ProseMirror position each character sits at. */
function textWithPositions(chapter: ChapterDoc): Array<{ text: string; at: number }> {
  const runs: Array<{ text: string; at: number }> = [];
  const walk = (node: Node | undefined, pos: number): number => {
    if (!node) return pos;
    if (node.type === 'text') {
      if (node.text) runs.push({ text: node.text, at: pos });
      return pos + (node.text?.length ?? 0);
    }
    if (node.type === 'citation') return pos + 1;
    let inner = pos + 1;
    for (const child of node.content ?? []) inner = walk(child, inner);
    return inner + 1;
  };
  let pos = 0;
  for (const child of (chapter.content as Node | undefined)?.content ?? []) pos = walk(child, pos);
  return runs;
}

export function untaggedCitationsIn(chapter: ChapterDoc): CitationFinding[] {
  const out: CitationFinding[] = [];
  for (const run of textWithPositions(chapter)) {
    for (const { re, why } of UNTAGGED_PATTERNS) {
      // Each pattern is global; reset before every run so state does not leak between them.
      re.lastIndex = 0;
      let match: RegExpExecArray | null = re.exec(run.text);
      while (match) {
        out.push({
          kind: 'UNTAGGED',
          message: `“${match[0]}” ${why}, but it is plain text — it will not appear in the bibliography and will not follow a style switch.`,
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          from: run.at + match.index,
          to: run.at + match.index + match[0].length,
          text: match[0],
        });
        match = re.exec(run.text);
      }
    }
  }
  return out;
}

export type CheckInput = {
  chapters: readonly ChapterDoc[];
  /** The document's library: id and a name for the message. */
  sources: ReadonlyArray<{ id: string; title?: string | null; rawReference?: string | null }>;
};

/**
 * All three checks over a whole document.
 *
 * ORPHAN — a citation node pointing at a source that is no longer in the library. B.5 renders it
 * red-dashed rather than deleting it, because deleting a student's sentence silently is worse
 * than leaving a visible problem.
 * UNUSED — a source in the library that nothing cites. Not an error: a reading list is allowed.
 * UNTAGGED — the regex above.
 */
export function runCitationChecks(input: CheckInput): CitationFinding[] {
  const library = new Map(input.sources.map((s) => [s.id, s]));
  const cited = new Set<string>();
  const findings: CitationFinding[] = [];

  for (const chapter of input.chapters) {
    for (const node of citationNodesIn(chapter)) {
      if (node.sourceId && library.has(node.sourceId)) {
        cited.add(node.sourceId);
        continue;
      }
      findings.push({
        kind: 'ORPHAN',
        message: node.sourceId
          ? 'This citation points at a source that is no longer in your library. Re-add the source, or delete the citation.'
          : 'This citation has no source attached. Delete it and insert it again from the Sources panel.',
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        from: node.from,
        to: node.to,
        nodeKey: node.nodeKey,
        ...(node.sourceId ? { sourceId: node.sourceId } : {}),
      });
    }
    findings.push(...untaggedCitationsIn(chapter));
  }

  for (const source of input.sources) {
    if (cited.has(source.id)) continue;
    const name = source.title ?? source.rawReference ?? 'This source';
    findings.push({
      kind: 'UNUSED',
      message: `“${name}” is in your library but nothing cites it. Cite it, or leave it — an uncited source is not printed in the bibliography.`,
      sourceId: source.id,
    });
  }

  return findings;
}
