/**
 * Chat threads — ADR-0116, Jenni build plan R30.
 *
 * A thesis has any number of conversations; the panel lists them (the one used last first), starts
 * a new one and reopens an old one. Until migration 0045 a thesis had exactly one, on
 * `Document.meta.chat`; each of those became the first thread of its thesis.
 *
 * Owner only, like the rest of the chat (PRD §12.1): every query is scoped by the thesis's owner,
 * and a thread the caller does not own is reported as absent (404).
 *
 * A new chat is not a row until its first answer is stored, so starting one and asking nothing
 * (or being refused) leaves nothing behind in the list.
 */

import { Injectable } from '@nestjs/common';
import type { Prisma } from '@tc/db';
import { ConflictError, NotFoundError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import {
  fullTitle,
  questionCount,
  readTurns,
  type StoredTurn,
  THREAD_KEEP_TURNS,
  THREADS_LISTED,
  type ThreadCollection,
  type ThreadSummary,
  threadTitle,
} from './chat-threads.js';

/** Which thread a question goes to. */
export type ThreadChoice = {
  /** Continue this thread. */
  threadId?: string | undefined;
  /** Start a new thread (on the first stored answer); with `collectionId`, on that collection. */
  newThread?: boolean | undefined;
  collectionId?: string | undefined;
};

/**
 * The thread a question is asked in. `id` is null for a new chat, which becomes a row when its
 * first answer is stored. `collection` carries its papers, which are the whole of what the answer
 * may come from.
 */
export type OpenThread = {
  id: string | null;
  title: string;
  turns: StoredTurn[];
  collection: (ThreadCollection & { sourceIds: string[] }) | null;
};

/** One thread as the panel opens it. */
export type ThreadView = {
  /** Null when the thesis has no chat yet. */
  threadId: string | null;
  title: string;
  collection: ThreadCollection | null;
  collectionDeleted: boolean;
  /** The collection's name when the chat started, kept so a deleted one can still be named. */
  collectionName: string | null;
  turns: StoredTurn[];
};

const THREAD_SELECT = {
  id: true,
  title: true,
  turns: true,
  collectionId: true,
  collectionName: true,
  collection: { select: { id: true, name: true, items: { select: { sourceId: true } } } },
} as const;

type ThreadRow = Prisma.ChatThreadGetPayload<{ select: typeof THREAD_SELECT }>;

/** A thread whose collection was deleted (the id went to null, the name it started with stayed). */
function collectionDeleted(row: { collectionId: string | null; collectionName: string | null }) {
  return row.collectionId === null && row.collectionName !== null;
}

function deletedCollection(name: string): ConflictError {
  return new ConflictError(
    `This chat answered only from the collection “${name}”, which has been deleted. Start a new chat to ask again.`,
    { reason: 'CHAT_COLLECTION_DELETED' },
  );
}

function opened(row: ThreadRow): OpenThread {
  return {
    id: row.id,
    title: row.title,
    turns: readTurns(row.turns),
    collection: row.collection
      ? {
          id: row.collection.id,
          name: row.collection.name,
          sourceIds: row.collection.items.map((i) => i.sourceId),
        }
      : null,
  };
}

@Injectable()
export class ChatThreadsService {
  constructor(private readonly prisma: PrismaService) {}

  private async ownedDocument(ownerId: string, documentId: string): Promise<void> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      select: { id: true },
    });
    if (!document) throw new NotFoundError('That document');
  }

  /**
   * The thread a question goes to, decided before any unit is taken so that every refusal here
   * costs nothing. A question that names no thread continues the thesis's latest whole-library
   * chat — what "the chat" was before threads — or starts one.
   */
  async open(ownerId: string, documentId: string, choice: ThreadChoice): Promise<OpenThread> {
    if (choice.threadId) {
      const row = await this.prisma.chatThread.findFirst({
        where: { id: choice.threadId, documentId, document: { ownerId } },
        select: THREAD_SELECT,
      });
      if (!row) throw new NotFoundError('That chat');
      if (collectionDeleted(row)) throw deletedCollection(row.collectionName ?? '');
      return opened(row);
    }
    if (choice.newThread) {
      if (!choice.collectionId) return { id: null, title: '', turns: [], collection: null };
      const collection = await this.prisma.sourceCollection.findFirst({
        where: { id: choice.collectionId, documentId, document: { ownerId } },
        select: { id: true, name: true, items: { select: { sourceId: true } } },
      });
      if (!collection) throw new NotFoundError('That collection');
      return {
        id: null,
        title: '',
        turns: [],
        collection: {
          id: collection.id,
          name: collection.name,
          sourceIds: collection.items.map((i) => i.sourceId),
        },
      };
    }
    const latest = await this.prisma.chatThread.findFirst({
      where: { documentId, document: { ownerId }, collectionName: null },
      orderBy: { updatedAt: 'desc' },
      select: THREAD_SELECT,
    });
    return latest ? opened(latest) : { id: null, title: '', turns: [], collection: null };
  }

  /**
   * Stores the conversation after an answer, and returns the thread's id. A new chat becomes a
   * row here, titled by its first question. Only the last THREAD_KEEP_TURNS turns are kept.
   */
  async save(
    documentId: string,
    thread: OpenThread,
    turns: readonly StoredTurn[],
    firstQuestion: string,
  ): Promise<string> {
    const kept = turns.slice(-THREAD_KEEP_TURNS);
    const data = {
      turns: kept as unknown as Prisma.InputJsonValue,
      questions: questionCount(kept),
    };
    if (thread.id) {
      // `updateMany` so a chat deleted in another tab meanwhile is started again rather than lost;
      // `updatedAt` by hand, because it is what orders the list.
      const { count } = await this.prisma.chatThread.updateMany({
        where: { id: thread.id, documentId },
        data: { ...data, updatedAt: new Date() },
      });
      if (count > 0) return thread.id;
    }
    const row = await this.prisma.chatThread.create({
      data: {
        documentId,
        title: threadTitle(thread.title || firstQuestion),
        collectionId: thread.collection?.id ?? null,
        collectionName: thread.collection?.name ?? null,
        ...data,
      },
      select: { id: true },
    });
    return row.id;
  }

  /** One thread for the panel: the one named, or the one used last. */
  async history(ownerId: string, documentId: string, threadId?: string): Promise<ThreadView> {
    await this.ownedDocument(ownerId, documentId);
    const row = await this.prisma.chatThread.findFirst({
      where: threadId ? { id: threadId, documentId } : { documentId },
      orderBy: { updatedAt: 'desc' },
      select: THREAD_SELECT,
    });
    if (!row) {
      if (threadId) throw new NotFoundError('That chat');
      return {
        threadId: null,
        title: '',
        collection: null,
        collectionDeleted: false,
        collectionName: null,
        turns: [],
      };
    }
    const turns = readTurns(row.turns);
    return {
      threadId: row.id,
      title: fullTitle(row.title, turns),
      collection: row.collection ? { id: row.collection.id, name: row.collection.name } : null,
      collectionDeleted: collectionDeleted(row),
      collectionName: row.collectionName,
      turns,
    };
  }

  /** The thesis's chats, the one used last first. */
  async list(ownerId: string, documentId: string): Promise<{ threads: ThreadSummary[] }> {
    await this.ownedDocument(ownerId, documentId);
    const rows = await this.prisma.chatThread.findMany({
      where: { documentId },
      orderBy: { updatedAt: 'desc' },
      take: THREADS_LISTED,
      select: {
        id: true,
        title: true,
        questions: true,
        collectionId: true,
        collectionName: true,
        createdAt: true,
        updatedAt: true,
        collection: { select: { id: true, name: true } },
      },
    });
    // A title stored cut (before 2026-10-08) is made whole from its first question; only those
    // rows' turns are read, so the list still need not read every conversation.
    const cut = rows.filter((row) => row.title.endsWith('…')).map((row) => row.id);
    const whole = new Map<string, string>();
    if (cut.length > 0) {
      const withTurns = await this.prisma.chatThread.findMany({
        where: { id: { in: cut }, documentId },
        select: { id: true, title: true, turns: true },
      });
      for (const row of withTurns) whole.set(row.id, fullTitle(row.title, readTurns(row.turns)));
    }
    return {
      threads: rows.map((row) => ({
        id: row.id,
        title: whole.get(row.id) ?? row.title,
        questions: row.questions,
        collection: row.collection,
        collectionDeleted: collectionDeleted(row),
        collectionName: row.collectionName,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    };
  }

  /** Deletes one chat, on the student's press; the thesis and its library are untouched. */
  async remove(ownerId: string, documentId: string, threadId: string): Promise<{ deleted: true }> {
    const { count } = await this.prisma.chatThread.deleteMany({
      where: { id: threadId, documentId, document: { ownerId } },
    });
    if (count === 0) throw new NotFoundError('That chat');
    return { deleted: true };
  }

  /** Empties a chat — the one named, or the one used last. */
  async clear(ownerId: string, documentId: string, threadId?: string): Promise<{ cleared: true }> {
    await this.ownedDocument(ownerId, documentId);
    const row = await this.prisma.chatThread.findFirst({
      where: threadId ? { id: threadId, documentId } : { documentId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    if (!row) {
      if (threadId) throw new NotFoundError('That chat');
      return { cleared: true };
    }
    await this.prisma.chatThread.updateMany({
      where: { id: row.id, documentId },
      data: { turns: [], questions: 0, updatedAt: new Date() },
    });
    return { cleared: true };
  }

  /**
   * Thumbs on an answer (2026-10-04, from the Jenni study), kept on the turn. The panel names the
   * thread; without one, the thread holding the answer is found by its id. No model call.
   */
  async rate(
    ownerId: string,
    documentId: string,
    turnId: string,
    rating: 1 | -1 | 0,
    threadId?: string,
  ): Promise<{ ok: true; threadId: string }> {
    await this.ownedDocument(ownerId, documentId);
    const thread = await this.prisma.chatThread.findFirst({
      where: threadId
        ? { id: threadId, documentId }
        : { documentId, turns: { array_contains: [{ id: turnId }] } },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, turns: true, updatedAt: true },
    });
    if (!thread) throw new NotFoundError('That answer');
    const turns = readTurns(thread.turns);
    if (!turns.some((t) => t.id === turnId && t.role === 'assistant')) {
      throw new NotFoundError('That answer');
    }
    // `undefined` drops out of the JSON, which is how a thumbs is taken back.
    const next = turns.map((t) =>
      t.id === turnId ? { ...t, rating: rating === 0 ? undefined : rating } : t,
    );
    // Its own `updatedAt` written back: a thumbs is not using the chat, and must not move it to
    // the top of the list.
    await this.prisma.chatThread.updateMany({
      where: { id: thread.id, documentId },
      data: { turns: next as unknown as Prisma.InputJsonValue, updatedAt: thread.updatedAt },
    });
    return { ok: true, threadId: thread.id };
  }
}
