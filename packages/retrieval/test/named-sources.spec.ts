/**
 * Chat's `@` mention, at the one place it changes retrieval.
 *
 * A chapter's pins are a standing filter: "draw on these papers when writing this chapter". A
 * mention is a one-question override: "answer this from these papers". The mention has to
 * *replace* the pins rather than add to them — otherwise "what does @Kumar say?" in a chapter
 * pinned to three other papers would answer from four.
 */

import { describe, expect, it } from 'vitest';
import { type ContextClient, retrievePassages } from '../src/context.js';
import { EMBEDDING_DIMENSIONS } from '../src/pgvector.js';

function fakeDb(pins: string[]) {
  const sourceFilters: unknown[] = [];
  const db: ContextClient = {
    $executeRawUnsafe: async () => 0,
    $queryRawUnsafe: async <T>(_sql: string, ...values: unknown[]) => {
      // Parameters: vector, documentId, source filter, limit.
      sourceFilters.push(values[2]);
      return [] as T;
    },
    documentMemory: { findUnique: async () => ({ outline: [] }) },
    chapterSourcePin: { findMany: async () => pins.map((sourceId) => ({ sourceId })) },
  };
  return { db, sourceFilters };
}

const embed = async () => [Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.01)];
const chapter = {
  id: 'c1',
  documentId: 'd1',
  outlineNodeId: 'ch1',
  title: 'Chapter 1',
  scopeNote: null,
  content: null,
};

describe('naming sources for one question', () => {
  it('searches only the named sources, in place of the chapter’s pins', async () => {
    const { db, sourceFilters } = fakeDb(['pinned-a', 'pinned-b']);
    await retrievePassages(db, embed, chapter, 'What does Kumar say?', 'CHAT', {
      sourceIds: ['named-x'],
    });
    expect(sourceFilters).toEqual([['named-x']]);
  });

  it('falls back to the pins when nothing is named', async () => {
    const { db, sourceFilters } = fakeDb(['pinned-a']);
    await retrievePassages(db, embed, chapter, 'What do my sources say?', 'CHAT');
    expect(sourceFilters).toEqual([['pinned-a']]);
  });

  it('searches the whole library when there are neither pins nor names', async () => {
    const { db, sourceFilters } = fakeDb([]);
    await retrievePassages(db, embed, chapter, 'Anything?', 'CHAT', { sourceIds: [] });
    // `null` is "no filter" in the query; the document itself still bounds the search.
    expect(sourceFilters).toEqual([null]);
  });
});
