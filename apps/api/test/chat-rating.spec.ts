/**
 * Thumbs on a chat answer (2026-10-04, from the Jenni study). The rating lives on the stored
 * turn, in its chat (ADR-0116: `ChatThreadsService.rate`; before threads it was on
 * `Document.meta.chat`); only the owner's own answers can be rated. Prisma is faked: this pins the
 * behaviour, not the query. The real queries run in `chat-threads-api.spec.ts`.
 */

import { describe, expect, it } from 'vitest';
import { ChatThreadsService } from '../src/modules/assist/chat-threads.service.js';

type Turn = { id: string; role: string; text: string; rating?: number };

function service(turns: Turn[], ownerId = 'user-1') {
  const writes: Array<{ turns: Turn[]; updatedAt?: Date }> = [];
  const updatedAt = new Date('2026-10-01T10:00:00Z');
  const prisma = {
    document: {
      findFirst: async ({ where }: { where: { ownerId: string } }) =>
        where.ownerId === ownerId ? { id: 'doc-1' } : null,
    },
    chatThread: {
      findFirst: async () => ({ id: 'thread-1', turns, updatedAt }),
      updateMany: async ({ data }: { data: { turns: Turn[]; updatedAt?: Date } }) => {
        // JSON drops `undefined`, as Postgres would.
        writes.push(JSON.parse(JSON.stringify(data)) as { turns: Turn[]; updatedAt?: Date });
        return { count: 1 };
      },
    },
  };
  // biome-ignore lint/suspicious/noExplicitAny: a test double for Nest's injected PrismaService
  const threads = new ChatThreadsService(prisma as any);
  return { threads, writes, updatedAt };
}

const TURNS: Turn[] = [
  { id: 'q1', role: 'user', text: 'What limits uptake?' },
  { id: 'a1', role: 'assistant', text: 'Cost.' },
];

describe('rating a chat answer', () => {
  it('stores the thumbs on the answer, and clears them', async () => {
    const { threads, writes } = service(TURNS);
    await threads.rate('user-1', 'doc-1', 'a1', -1);
    const stored = writes.at(-1)?.turns ?? [];
    expect(stored.find((t) => t.id === 'a1')?.rating).toBe(-1);

    const { threads: again, writes: w2 } = service(stored);
    await again.rate('user-1', 'doc-1', 'a1', 0);
    const cleared = w2.at(-1)?.turns ?? [];
    expect(cleared.find((t) => t.id === 'a1')?.rating).toBeUndefined();
  });

  it('keeps the chat where it was in the list: a thumbs is not using it', async () => {
    const { threads, writes, updatedAt } = service(TURNS);
    await threads.rate('user-1', 'doc-1', 'a1', 1, 'thread-1');
    expect(writes.at(-1)?.updatedAt).toBe(updatedAt.toISOString());
  });

  it('refuses a question, an unknown turn, and someone else’s thesis', async () => {
    const { threads } = service(TURNS);
    await expect(threads.rate('user-1', 'doc-1', 'q1', 1)).rejects.toThrow();
    await expect(threads.rate('user-1', 'doc-1', 'nope', 1)).rejects.toThrow();
    await expect(threads.rate('user-2', 'doc-1', 'a1', 1)).rejects.toThrow();
  });
});
