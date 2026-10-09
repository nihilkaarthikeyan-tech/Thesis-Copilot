/**
 * A research question with no thesis — ADR-0132 (Jenni build plan R30/R32), the web half's pure
 * part: the shapes `/research-chats` answers with, how a citation is labelled, and the two
 * presses that put a found paper into a thesis. Nothing here enters a thesis on its own: "Start a
 * thesis from this" and "Add to a thesis…" are the ordinary `POST /documents` and
 * `POST /documents/:id/sources/resolve`, called only from the student's press.
 */

/** A paper an answer cited: a search abstract, or a paper in one of the student's theses. */
export type ResearchPaper = {
  title: string;
  year: number | null;
  venue: string | null;
  doi: string | null;
  inLibrary: boolean;
  reference: { raw: string; doi?: string };
};

export type ResearchCitation = {
  key: string;
  sourceId: string;
  chunkId: string;
  label: string;
  beyond?: ResearchPaper;
  /** "All my theses": the thesis whose library the passage is from. */
  thesis?: { id: string; title: string };
  paper?: ResearchPaper;
};

export type ResearchTurn = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  citations?: ResearchCitation[];
  outcome?: string;
  beyond?: { papers: number; outsideLibrary: number; note: string };
  across?: true;
};

export type ResearchChatSummary = {
  id: string;
  title: string;
  questions: number;
  createdAt: string;
  updatedAt: string;
};

export type ResearchChatView = {
  id: string;
  title: string;
  turns: ResearchTurn[];
  papers: ResearchPaper[];
  suggestedTitle: string;
};

/** The literature (ADR-0060's search) or every passage in the student's own theses. */
export type ResearchSource = 'web' | 'theses';

/** One paper, once: by DOI where there is one, else by title. */
export function paperKey(paper: Pick<ResearchPaper, 'doi' | 'title'>): string {
  return (paper.doi ?? paper.title).toLowerCase();
}

/** The paper behind a citation, whichever way it was found. */
export function paperOf(citation: ResearchCitation): ResearchPaper | null {
  return citation.beyond ?? citation.paper ?? null;
}

/** The papers one answer cited, once each, in the order cited. */
export function papersOfTurn(turn: ResearchTurn): ResearchPaper[] {
  const seen = new Map<string, ResearchPaper>();
  for (const citation of turn.citations ?? []) {
    const paper = paperOf(citation);
    if (paper && !seen.has(paperKey(paper))) seen.set(paperKey(paper), paper);
  }
  return [...seen.values()];
}

/** A thesis title shortened for an inline label; the whole title is in the list below. */
export function shortThesisTitle(title: string, max = 32): string {
  const clean = title.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${cut.slice(0, space > max / 2 ? space : cut.length)}…`;
}

/**
 * The citations as the answer shows them: a passage from one of the student's theses is labelled
 * with its thesis ("Rao 2022 · Rooftop solar in Karnataka"), so a student with three theses can
 * tell where each finding sits.
 */
export function labelledCitations(citations: readonly ResearchCitation[]): ResearchCitation[] {
  return citations.map((c) =>
    c.thesis ? { ...c, label: `${c.label} · ${shortThesisTitle(c.thesis.title)}` } : c,
  );
}

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;

/**
 * "Start a thesis from this": a new thesis with the working title the student confirmed, made as
 * Start writing now makes one (ADR-0070/0072), and then the papers the student left ticked sent
 * to its library through the ordinary resolve path. Returns the new thesis and its first chapter, which the editor opens on.
 */
export async function startThesisFromChat(
  call: Api,
  title: string,
  papers: readonly ResearchPaper[],
): Promise<{ id: string; firstChapterId: string | null; queued: number }> {
  const created = await call<{ id: string; firstChapterId: string | null }>('/documents', {
    method: 'POST',
    body: JSON.stringify({ title: title.trim(), entryPath: 'A_TOPIC', start: 'writing' }),
  });
  const made = { id: created.id, firstChapterId: created.firstChapterId ?? null };
  if (papers.length === 0) return { ...made, queued: 0 };
  const resolved = await call<{ queued: number }>(`/documents/${created.id}/sources/resolve`, {
    method: 'POST',
    body: JSON.stringify({ references: papers.map((p) => p.reference) }),
  });
  return { ...made, queued: resolved.queued };
}

/** "Add to a thesis…": one paper into one thesis's library, through the resolve path. */
export async function addPaperToThesis(
  call: Api,
  documentId: string,
  paper: ResearchPaper,
): Promise<{ queued: number; alreadyPresent: number }> {
  return call(`/documents/${documentId}/sources/resolve`, {
    method: 'POST',
    body: JSON.stringify({ references: [paper.reference] }),
  });
}
