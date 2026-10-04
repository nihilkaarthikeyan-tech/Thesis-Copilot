/**
 * Thumbs on a chat answer (2026-10-04, from the Jenni study). The rating lives on the stored
 * turn; only the owner's own answers can be rated. Prisma is faked: this pins the behaviour, not
 * the query.
 */

import { describe, expect, it } from 'vitest';
import { ChatService } from '../src/modules/assist/chat.service.js';

function service(meta: unknown, ownerId = 'user-1') {
  const writes: unknown[] = [];
  const prisma = {
    document: {
      findFirst: async ({ where }: { where: { ownerId: string } }) =>
        where.ownerId === ownerId ? { id: 'doc-1', meta } : null,
      update: async ({ data }: { data: { meta: unknown } }) => {
        writes.push(data.meta);
        return {};
      },
    },
  };
  const args = [prisma, {}, {}, {}, {}, {}, {}, {}, {}].slice(0, ChatService.length);
  // biome-ignore lint/suspicious/noExplicitAny: a test double for Nest's injected arguments
  const chat = new (ChatService as any)(...args) as ChatService;
  return { chat, writes };
}

const META = {
  chat: {
    turns: [
      { id: 'q1', role: 'user', text: 'What limits uptake?' },
      { id: 'a1', role: 'assistant', text: 'Cost.', citations: [] },
    ],
  },
};

describe('rating a chat answer', () => {
  it('stores the thumbs on the answer, and clears them', async () => {
    const { chat, writes } = service(META);
    await chat.rate('user-1', 'doc-1', 'a1', -1);
    const stored = writes.at(-1) as { chat: { turns: Array<{ id: string; rating?: number }> } };
    expect(stored.chat.turns.find((t) => t.id === 'a1')?.rating).toBe(-1);

    const { chat: again, writes: w2 } = service(stored);
    await again.rate('user-1', 'doc-1', 'a1', 0);
    const cleared = w2.at(-1) as { chat: { turns: Array<{ id: string; rating?: number }> } };
    expect(cleared.chat.turns.find((t) => t.id === 'a1')?.rating).toBeUndefined();
  });

  it('refuses a question, an unknown turn, and someone else’s thesis', async () => {
    const { chat } = service(META);
    await expect(chat.rate('user-1', 'doc-1', 'q1', 1)).rejects.toThrow();
    await expect(chat.rate('user-1', 'doc-1', 'nope', 1)).rejects.toThrow();
    await expect(chat.rate('user-2', 'doc-1', 'a1', 1)).rejects.toThrow();
  });
});
