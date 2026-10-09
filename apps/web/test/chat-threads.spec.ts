/**
 * Chat threads, the panel's side (ADR-0116): what a question sends to name its chat, how a chat
 * is described in the list, what is remembered for the tab, and which papers a chat on one
 * collection can name.
 */

import { describe, expect, it } from 'vitest';
import {
  type ChatThreadSummary,
  inThreadCollection,
  NEW_CHAT,
  parseRemembered,
  threadBarState,
  threadFields,
  threadLine,
  threadWhen,
} from '../src/lib/chat-threads';

const NOW = new Date('2026-10-08T15:00:00');

function summary(over: Partial<ChatThreadSummary> = {}): ChatThreadSummary {
  return {
    id: 't1',
    title: 'What limits rooftop solar adoption?',
    questions: 3,
    collection: null,
    collectionDeleted: false,
    collectionName: null,
    createdAt: '2026-10-01T10:00:00',
    updatedAt: '2026-10-08T12:00:00',
    ...over,
  };
}

describe('the bar above the chat (QA 2026-10-08)', () => {
  it('says the chat is opening while it loads, never "New chat"', () => {
    expect(threadBarState(true, '')).toBe('loading');
    expect(threadBarState(true, 'Heat stress in dairy cattle')).toBe('loading');
  });

  it('then shows the title, or New chat for one not stored yet', () => {
    expect(threadBarState(false, 'Heat stress in dairy cattle')).toBe('title');
    expect(threadBarState(false, '')).toBe('new');
  });
});

describe('which chat a question goes to', () => {
  it('names the open chat', () => {
    expect(threadFields({ ...NEW_CHAT, id: 'abc' })).toEqual({ threadId: 'abc' });
  });

  it('starts a new one, on its collection when it has one', () => {
    expect(threadFields(NEW_CHAT)).toEqual({ newThread: true });
    expect(threadFields({ ...NEW_CHAT, collection: { id: 'c1', name: 'Methods' } })).toEqual({
      newThread: true,
      collectionId: 'c1',
    });
  });
});

describe('a chat in the list', () => {
  it('says when it was used, briefly', () => {
    expect(threadWhen('2026-10-08T14:59:40', NOW)).toBe('Just now');
    expect(threadWhen('2026-10-08T14:48:00', NOW)).toBe('12 min ago');
    expect(threadWhen('2026-10-08T12:00:00', NOW)).toBe('3 h ago');
    expect(threadWhen('2026-10-07T23:00:00', NOW)).toBe('Yesterday');
    expect(threadWhen('2026-10-02T09:00:00', NOW)).toBe('2 Oct');
    expect(threadWhen('2025-12-30T09:00:00', NOW)).toBe('30 Dec 2025');
    expect(threadWhen('not a date', NOW)).toBe('');
  });

  it('counts its questions and names its collection, or the one that was deleted', () => {
    expect(threadLine(summary(), NOW)).toBe('3 h ago · 3 questions');
    expect(threadLine(summary({ questions: 1 }), NOW)).toBe('3 h ago · 1 question');
    expect(threadLine(summary({ collection: { id: 'c1', name: 'Methods' } }), NOW)).toBe(
      '3 h ago · 3 questions · Methods',
    );
    expect(threadLine(summary({ collectionDeleted: true, collectionName: 'Methods' }), NOW)).toBe(
      '3 h ago · 3 questions · Methods (deleted)',
    );
  });
});

describe('what the tab remembers', () => {
  it('reads back a chat or a new one, and ignores anything else', () => {
    expect(parseRemembered('{"kind":"thread","id":"t1"}')).toEqual({ kind: 'thread', id: 't1' });
    expect(parseRemembered('{"kind":"new","collectionId":"c1"}')).toEqual({
      kind: 'new',
      collectionId: 'c1',
    });
    expect(parseRemembered('{"kind":"new"}')).toEqual({ kind: 'new', collectionId: null });
    expect(parseRemembered('{"kind":"thread"}')).toBeNull();
    expect(parseRemembered('not json')).toBeNull();
  });
});

describe('the papers a chat on one collection can name', () => {
  it('are those filed in it; a whole-library chat can name any', () => {
    const rows = [
      { id: 'a', collectionIds: ['c1'] },
      { id: 'b', collectionIds: ['c2'] },
      { id: 'c' },
    ];
    expect(inThreadCollection(rows, 'c1').map((r) => r.id)).toEqual(['a']);
    expect(inThreadCollection(rows, null).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});
