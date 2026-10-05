/**
 * Library hygiene through the real API: duplicates are found, a merge keeps every citation, pin
 * and passage it can, and a PDF attached to an existing source is stored and queued for reading
 * under a job id that keys on the file.
 */

import { jobId, jobKeyDigest } from '@tc/types';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildPdf, type Harness, startHarness } from './_harness.js';

let h: Harness;
let documentId: string;
let chapterId: string;
let keepId: string;
let dropId: string;
/** The kept record's chunk with the same text as the copy's cited passage. */
let keepChunkId: string;
let redis: Redis;
let queue: Queue;

const PASSAGE = 'Electrode wear rises with discharge current in the machining of Inconel 718.';

beforeAll(async () => {
  h = await startHarness('library-hygiene@example.com');
  const document = await h.prisma.document.create({
    data: { ownerId: h.userId, title: 'EDM of Inconel', entryPath: 'A_TOPIC' },
  });
  documentId = document.id;

  const base = {
    documentId,
    status: 'RESOLVED' as const,
    title: 'Electrode wear in EDM of Inconel 718',
    year: 2021,
    authors: [{ family: 'Rao', given: 'P.' }],
  };
  // The better record: full text, so the merge should suggest keeping it.
  const keep = await h.prisma.source.create({
    data: { ...base, doi: '10.1000/edm.2021.7', groundingLevel: 'FULL_TEXT' },
  });
  const drop = await h.prisma.source.create({
    data: { ...base, doi: 'https://doi.org/10.1000/EDM.2021.7', groundingLevel: 'ABSTRACT' },
  });
  keepId = keep.id;
  dropId = drop.id;
  // An unrelated source, which must come through untouched.
  await h.prisma.source.create({
    data: { ...base, title: 'Wire EDM of titanium', doi: '10.1000/other' },
  });

  const keepChunk = await h.prisma.sourceChunk.create({
    data: { sourceId: keepId, ordinal: 0, text: PASSAGE, tokenCount: 14 },
  });
  const dropChunk = await h.prisma.sourceChunk.create({
    data: { sourceId: dropId, ordinal: 0, text: PASSAGE, tokenCount: 14 },
  });
  const lostChunk = await h.prisma.sourceChunk.create({
    data: { sourceId: dropId, ordinal: 1, text: 'Only in the abstract record.', tokenCount: 6 },
  });

  const chapter = await h.prisma.chapter.create({
    data: {
      documentId,
      outlineNodeId: 'n1',
      title: 'Literature Review',
      order: 1,
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Wear rises with current ' },
              {
                type: 'citation',
                attrs: { key: 'c1', sourceId: dropId, chunkId: dropChunk.id, locator: 'p. 4' },
              },
              { type: 'text', text: ' and with time ' },
              { type: 'citation', attrs: { key: 'c2', sourceId: dropId, chunkId: lostChunk.id } },
            ],
          },
        ],
      },
    },
  });
  chapterId = chapter.id;
  await h.prisma.citation.createMany({
    data: [
      { chapterId, sourceId: dropId, chunkId: dropChunk.id, nodeKey: 'c1' },
      { chapterId, sourceId: dropId, chunkId: lostChunk.id, nodeKey: 'c2' },
    ],
  });
  await h.prisma.chapterSourcePin.create({ data: { chapterId, sourceId: dropId } });
  keepChunkId = keepChunk.id;

  redis = new Redis(process.env.REDIS_URL ?? '', { maxRetriesPerRequest: null });
  queue = new Queue('index-source', { connection: redis });
}, 300_000);

afterAll(async () => {
  await queue?.close();
  await redis?.quit();
  await h?.stop();
});

describe('possible duplicates', () => {
  it('finds the two records with one DOI and suggests keeping the full-text one', async () => {
    const res = await h.api(`/documents/${documentId}/sources/duplicates`);
    expect(res.status).toBe(200);
    const pairs = (await res.json()) as Array<{
      reason: string;
      keep: { id: string; citeCount: number; pinCount: number };
      drop: { id: string; citeCount: number; pinCount: number };
    }>;
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.reason).toBe('SAME_DOI');
    expect(pairs[0]?.keep.id).toBe(keepId);
    expect(pairs[0]?.drop).toMatchObject({ id: dropId, citeCount: 2, pinCount: 1 });
  });

  it('lists the library with a reason for each source the AI cannot read in full', async () => {
    const res = await h.api(`/documents/${documentId}/sources`);
    const rows = (await res.json()) as Array<{ id: string; noFullTextReason: string | null }>;
    expect(rows.find((r) => r.id === keepId)?.noFullTextReason).toBeNull();
    expect(rows.find((r) => r.id === dropId)?.noFullTextReason).toMatch(/only the abstract/);
  });
});

describe('merging', () => {
  it('refuses to merge a source into itself', async () => {
    const res = await h.api(`/sources/${keepId}/merge`, {
      method: 'POST',
      body: JSON.stringify({ duplicateId: keepId }),
    });
    expect(res.status).toBe(400);
  });

  it('moves every citation, passage and pin to the kept record, then removes the copy', async () => {
    const before = await h.prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });

    const res = await h.api(`/sources/${keepId}/merge`, {
      method: 'POST',
      body: JSON.stringify({ duplicateId: dropId }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      keptId: keepId,
      removedId: dropId,
      citationsMoved: 2,
      passagesCleared: 1,
      pinsMoved: 1,
      chaptersChanged: 1,
      fileMoved: false,
    });

    const after = await h.prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    // The version moved, so an open editor reloads rather than saving the old ids back.
    expect(after.version).toBe(before.version + 1);
    expect(JSON.stringify(after.content)).not.toContain(dropId);
    // jsonb reorders keys, so compare the nodes, not the text.
    const nodes = (
      after.content as { content: Array<{ content: Array<{ type: string; attrs?: unknown }> }> }
    ).content[0]?.content.filter((node) => node.type === 'citation');
    expect(nodes?.map((node) => node.attrs)).toEqual([
      { key: 'c1', sourceId: keepId, chunkId: keepChunkId, locator: 'p. 4' },
      { key: 'c2', sourceId: keepId, chunkId: null },
    ]);

    const rows = await h.prisma.citation.findMany({
      where: { chapterId },
      orderBy: { nodeKey: 'asc' },
    });
    expect(rows.map((r) => [r.nodeKey, r.sourceId, r.chunkId])).toEqual([
      ['c1', keepId, keepChunkId],
      ['c2', keepId, null],
    ]);
    expect(await h.prisma.chapterSourcePin.findMany({ where: { chapterId } })).toEqual([
      { chapterId, sourceId: keepId, section: '' },
    ]);
    expect(await h.prisma.source.findUnique({ where: { id: dropId } })).toBeNull();
    expect(await h.prisma.source.count({ where: { documentId } })).toBe(2);

    // The text before the merge is one click away in History.
    const snapshot = await h.prisma.documentVersion.findFirst({
      where: { chapterId, reason: 'PRE_MERGE' },
    });
    expect(snapshot).not.toBeNull();

    const again = await h.api(`/documents/${documentId}/sources/duplicates`);
    expect(await again.json()).toEqual([]);
  });
});

describe('attaching a PDF to a source', () => {
  async function upload(sourceId: string, bytes: Buffer, filename = 'paper.pdf') {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), filename);
    return fetch(`${h.baseUrl}/api/v1/sources/${sourceId}/upload`, {
      method: 'POST',
      headers: { cookie: h.cookie },
      body: form,
    });
  }

  it('stores the file on that source and queues it for reading, keyed on the file', async () => {
    const source = await h.prisma.source.create({
      data: { documentId, status: 'RESOLVED', title: 'Paywalled paper', doi: '10.1000/paywalled' },
    });
    const res = await upload(source.id, buildPdf(['Electrode wear in EDM.']));
    expect(res.status).toBe(201);
    const view = (await res.json()) as { id: string; hasFile: boolean };
    expect(view).toMatchObject({ id: source.id, hasFile: true });

    const row = await h.prisma.source.findUniqueOrThrow({ where: { id: source.id } });
    expect(row.fileKey).toMatch(
      new RegExp(`^sources/${documentId}/${source.id}-[0-9a-f]{16}\\.pdf$`),
    );
    const job = await queue.getJob(
      jobId('index-source', source.id, jobKeyDigest(row.fileKey as string)),
    );
    expect(job?.data).toMatchObject({ sourceId: source.id, documentId, contentKey: row.fileKey });

    // A different file is a different job, not one swallowed as a repeat of the first.
    const second = await upload(source.id, buildPdf(['A corrected copy.']));
    expect(second.status).toBe(201);
    const updated = await h.prisma.source.findUniqueOrThrow({ where: { id: source.id } });
    expect(updated.fileKey).not.toBe(row.fileKey);
    expect(
      await queue.getJob(jobId('index-source', source.id, jobKeyDigest(updated.fileKey as string))),
    ).toBeDefined();
  });

  it('refuses a file that is not a PDF', async () => {
    const source = await h.prisma.source.create({
      data: { documentId, status: 'RESOLVED', title: 'Another' },
    });
    const res = await upload(source.id, Buffer.from('hello'), 'notes.txt');
    expect(res.status).toBe(400);
    expect(
      (await h.prisma.source.findUniqueOrThrow({ where: { id: source.id } })).fileKey,
    ).toBeNull();
  });
});
