/**
 * Chat threads, the pure part — ADR-0116.
 *
 * A thesis has any number of conversations (`ChatThread`), where it had one on
 * `Document.meta.chat`. What a stored turn is, how a thread is titled, how much of it is kept, and
 * the two refusals a chat on one collection gives in its own words. The rows are
 * `chat-threads.service.ts`.
 */

import { randomUUID } from 'node:crypto';
import type { ChatTurn } from '@tc/ai';
import type { BeyondPaper } from './beyond-library.js';
import type { DeepSummary } from './chat-deep.js';
import type { ResearchSummary } from './chat-research.js';

/**
 * How many turns a thread keeps: thirty questions and their answers. A.4 sends the model only the
 * last four (`CHAT.keepTurns`, applied by the builders); the rest is for the student to read back
 * when they reopen the chat. Before threads only the last four were kept at all, because that was
 * all the model was sent.
 */
export const THREAD_KEEP_TURNS = 60;

/** The list shows the most recent this many chats of a thesis. */
export const THREADS_LISTED = 100;

/**
 * Before 2026-10-08 a thread's title was its first question cut here, with "…" (and migration
 * 0045 cut the same way). Titles are now the whole question; this is kept to recognise the old,
 * cut ones (`fullTitle`).
 */
export const THREAD_TITLE_MAX = 80;

/**
 * A citation in an answer. A library one opens its passage; a `beyond` one (ADR-0060) is a paper
 * the search found, with an empty `sourceId` — not citable in the thesis until it is added.
 */
export type ChatCitation = {
  key: string;
  sourceId: string;
  chunkId: string;
  label: string;
  beyond?: BeyondPaper;
  /** ADR-0083: the passage was a file attached to the question; not a source, not citable. */
  attachment?: { name: string };
};

/** What a beyond-library answer read, for the line under it. */
export type BeyondSummary = { papers: number; outsideLibrary: number; note: string };

/**
 * A turn as stored on the thread. The thread is trimmed from the front (THREAD_KEEP_TURNS), so an
 * index is not an identity; the id is what the panel keys its list on.
 * `rating`: the student's thumbs on an answer (2026-10-04); absent when not rated.
 */
export type StoredTurn = ChatTurn & {
  id: string;
  rating?: 1 | -1;
  /**
   * QA 2026-10-08: an answer that is a scripted reply rather than an answer ("not-enough",
   * "beyond-not-enough", "writing-redirect"), so the panel offers no "Add to document" under it
   * after a reload either. Absent on an ordinary answer.
   */
  outcome?: string;
  citations?: ChatCitation[];
  /** ADR-0060: the answer was written from search abstracts, not the library. */
  beyond?: BeyondSummary;
  /** ADR-0074: the library's passages and abstracts a search found; ADR-0080 with the plan. */
  research?: ResearchSummary | DeepSummary;
};

/** A collection a thread answers from (its live name). */
export type ThreadCollection = { id: string; name: string };

/** One row of the list of chats. */
export type ThreadSummary = {
  id: string;
  title: string;
  questions: number;
  collection: ThreadCollection | null;
  /**
   * The chat answered only from a collection that has since been deleted. It can be read back,
   * not asked again: answering from the whole library instead would change what it stands on
   * without the student choosing that.
   */
  collectionDeleted: boolean;
  /** The collection's name when the chat started, kept so a deleted one can still be named. */
  collectionName: string | null;
  createdAt: string;
  updatedAt: string;
};

/** A thread's turns, read defensively: the column is JSON and older rows came from `meta`. */
export function readTurns(value: unknown): StoredTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (t): t is StoredTurn =>
        typeof t === 'object' &&
        t !== null &&
        ((t as ChatTurn).role === 'user' || (t as ChatTurn).role === 'assistant') &&
        typeof (t as ChatTurn).text === 'string',
    )
    .map((t) => ({ ...t, id: typeof t.id === 'string' && t.id ? t.id : randomUUID() }))
    .slice(-THREAD_KEEP_TURNS);
}

/** The questions a thread holds. */
export function questionCount(turns: readonly StoredTurn[]): number {
  return turns.filter((t) => t.role === 'user').length;
}

/**
 * A new thread's title: its whole first question, spaces collapsed (QA 2026-10-08, ADR-0116's
 * amendment). It was cut at 80 characters with "…", so the tooltip and the bar showed a cut
 * question; the list cuts it on screen with CSS instead. A question is at most 2,000 characters
 * (`POST /chat`), so the title is too.
 */
export function threadTitle(question: string): string {
  const text = question.replace(/\s+/g, ' ').trim();
  return text.length === 0 ? 'Chat' : text;
}

/**
 * A title stored cut (before 2026-10-08, or by migration 0045) made whole again from the thread's
 * first question, when that question is still among the kept turns and is the one the title was
 * cut from. Anything else is returned as it is.
 */
export function fullTitle(title: string, turns: readonly StoredTurn[]): string {
  if (!title.endsWith('…')) return title;
  const stem = title.slice(0, -1).trimEnd();
  const first = turns.find((t) => t.role === 'user');
  if (!first || stem.length === 0) return title;
  const question = threadTitle(first.text);
  return question.length > stem.length && question.startsWith(stem) ? question : title;
}

/**
 * The off-topic refusal in a chat on one collection. Unlike the library's (`OFF_TOPIC_REPLY`) it
 * offers no search beyond the library: the student chose to ask these papers only.
 */
export function collectionOffTopicReply(name: string): string {
  return (
    `This chat answers only from the papers in the collection “${name}”. Nothing in them ` +
    'relates to that, so there is nothing for me to answer from. Ask about those papers, or ' +
    'start a new chat on your whole library.'
  );
}

/** A collection whose papers have no readable text yet (the `@` refusal, for a collection). */
export function collectionEmptyReply(name: string): string {
  return (
    `The papers in the collection “${name}” have no readable text yet, so there is nothing in ` +
    'them to answer from. Upload their PDFs in Sources, or wait for them to finish being read, ' +
    'and ask again.'
  );
}
