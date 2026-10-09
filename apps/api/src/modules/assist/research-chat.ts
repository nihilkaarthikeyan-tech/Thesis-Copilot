/**
 * A research question asked with no thesis — ADR-0132 (Jenni build plan R30/R32), the pure half.
 *
 * What the student is told, the memory block a question with no thesis is asked under, and the
 * papers a chat found (for "Start a thesis from this"). No model, no database, no network:
 * `ResearchChatService` does the wiring. The answer itself is ADR-0060's: the abstracts a
 * scholarly search returned are A.4's passages, and nothing else may be cited.
 */

import { buildMemoryBlock } from '@tc/ai';
import type { BeyondPaper } from './beyond-library.js';
import type { StoredTurn } from './chat-threads.js';

export const RESEARCH_CHAT = {
  /** The list on the thesis list shows the most recent this many. */
  listed: 50,
  /** The same as a thesis's chat (`THREAD_KEEP_TURNS`): thirty questions and their answers. */
  keepTurns: 60,
  /** A thesis title is at most 300 characters (`POST /documents`). */
  maxThesisTitle: 300,
} as const;

/**
 * The memory block a question with no thesis is asked under: A.0.1's own template with nothing
 * in it — no working title, no outline, no glossary, no style profile. Rendered by the same
 * builder, so the cached system block has the shape A.4 was evaluated on; there is simply no
 * thesis to describe. Not a new prompt (rule 6): no word of it is ours.
 */
export function noThesisMemoryBlock(): string {
  return buildMemoryBlock({
    scope: { workingTitle: '', problemStatement: '', objectives: [], whyOpen: '' },
    outline: [],
    glossary: {},
    styleProfile: null,
    chapter: { outlineNodeId: '', text: '' },
  }).text;
}

/**
 * The relevance floor's refusal for a question with no thesis (`RELEVANCE_FLOOR`, `@tc/retrieval`):
 * nothing the search found is near the question. Written by the server; no model call, no charge.
 */
export const NO_THESIS_OFF_TOPIC_REPLY =
  'Nothing the search found relates to that, so there is nothing for me to answer from. This ' +
  'chat answers research questions from the abstracts of published papers: name the subject, ' +
  'the method or the population you are asking about.';

/** The line under an answer: what it stood on, and what the student can do with the papers. */
export function noThesisNote(papers: number): string {
  const noun = `paper${papers === 1 ? '' : 's'}`;
  return (
    `From the abstracts of ${papers} ${noun} the search found, none of them in a thesis yet. ` +
    'Add the ones you use to a thesis, or start one from this chat.'
  );
}

/**
 * Every paper the chat's answers cited, once each, in the order first cited — what "Start a thesis
 * from this" offers to put in the new thesis's library. Only papers an answer cited: the search
 * returns more, and the student has seen only these.
 */
export function papersOfChat(turns: readonly StoredTurn[]): BeyondPaper[] {
  const seen = new Map<string, BeyondPaper>();
  for (const turn of turns) {
    if (turn.role !== 'assistant') continue;
    for (const citation of turn.citations ?? []) {
      const paper = citation.beyond;
      if (!paper) continue;
      const key = (paper.doi ?? paper.title).toLowerCase();
      if (!seen.has(key)) seen.set(key, paper);
    }
  }
  return [...seen.values()];
}

/**
 * A working title from a question: spaces collapsed, cut at a word under the 300 characters a
 * thesis title may have. The student edits it before anything is created.
 */
export function thesisTitleFrom(question: string): string {
  const text = question.replace(/\s+/g, ' ').trim();
  if (text.length <= RESEARCH_CHAT.maxThesisTitle) return text;
  const cut = text.slice(0, RESEARCH_CHAT.maxThesisTitle - 1);
  const space = cut.lastIndexOf(' ');
  return `${cut.slice(0, space > 0 ? space : cut.length)}…`;
}
