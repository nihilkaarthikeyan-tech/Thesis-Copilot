/**
 * ADR-0135: the query a chapter with no scope note sends. On Start writing now the cursor is under
 * "Chapter 1" and the chapter has no scope note until the plan lands, so §10.4's query was the two
 * words "Chapter 1" and the passages it found said nothing about the thesis. The working title
 * stands in for the missing scope note; a chapter that has one is unchanged.
 */

import { describe, expect, it } from 'vitest';
import { type ContextClient, queryScope, retrievePassages } from '../src/context.js';
import { EMBEDDING_DIMENSIONS } from '../src/pgvector.js';

const TITLE = 'Barriers to rooftop solar adoption among rural households in Karnataka';

function setup(scope: unknown) {
  const embedded: string[] = [];
  const db: ContextClient = {
    $executeRawUnsafe: async () => 0,
    $queryRawUnsafe: async <T>() => [] as T,
    documentMemory: { findUnique: async () => ({ outline: [], scope }) },
    chapterSourcePin: { findMany: async () => [] },
  };
  const embed = async (texts: readonly string[]) => {
    embedded.push(...texts);
    return [Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.01)];
  };
  return { db, embed, embedded };
}

const chapter = (scopeNote: string | null) => ({
  id: 'c1',
  documentId: 'd1',
  outlineNodeId: 'ch1',
  title: 'Chapter 1',
  scopeNote,
  content: null,
});

describe('the query of a chapter with no scope note', () => {
  it('uses the working title in place of the missing scope note', async () => {
    const { db, embed, embedded } = setup({ workingTitle: TITLE });
    await retrievePassages(db, embed, chapter(null), 'Chapter 1\n', 'ASSIST');
    expect(embedded).toEqual([`Chapter 1 ${TITLE}`]);
  });

  it('keeps the chapter’s own scope note when it has one', async () => {
    const { db, embed, embedded } = setup({ workingTitle: TITLE });
    await retrievePassages(db, embed, chapter('Cost and subsidies.'), 'Chapter 1\n', 'ASSIST');
    expect(embedded).toEqual(['Chapter 1 Cost and subsidies.']);
  });

  it('searches a typed sentence as before, without the title', async () => {
    const { db, embed, embedded } = setup({ workingTitle: TITLE });
    await retrievePassages(db, embed, chapter(null), 'Upfront cost is named first.', 'ASSIST');
    expect(embedded).toEqual(['Upfront cost is named first.']);
  });

  it('leaves chat alone, so the relevance floor still reads only the question', async () => {
    const { db, embed, embedded } = setup({ workingTitle: TITLE });
    await retrievePassages(db, embed, chapter(null), 'What is the weather today?', 'CHAT');
    expect(embedded).toEqual(['What is the weather today?']);
    expect(queryScope(null, { workingTitle: TITLE }, 'Chapter 1', 'CHAT')).toBeNull();
  });

  it('treats a blank scope note as none, and a missing scope as no title', () => {
    expect(queryScope('  ', { workingTitle: TITLE })).toBe(TITLE);
    expect(queryScope(null, { workingTitle: TITLE }, '')).toBe(TITLE);
    expect(queryScope(null, {})).toBeNull();
    expect(queryScope(null, null)).toBeNull();
    expect(queryScope(null, { workingTitle: 42 })).toBeNull();
  });
});
