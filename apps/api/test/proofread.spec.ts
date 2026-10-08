/**
 * Proofreading through its real HTTP path — ADR-0026.
 *
 * The cap test every metered action has: a run is one `COMMAND` unit, charged before the model is
 * called, and at the cap the refusal comes with no call made. Around it, the things only the
 * endpoint can show: the corrections come back as data and the chapter is untouched; a chapter
 * with nothing to read costs nothing; a pending AI draft is not read, because it is not the
 * student's text yet; and a chapter longer than one run is read in parts, each saying where the
 * next one starts. R26 (ADR-0126): a range reads one paragraph only, for the same one unit.
 */

import type { Prisma } from '@tc/db';
import { blocksOf } from '@tc/retrieval';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { periodFor } from '../src/modules/usage/usage.service.js';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let documentId: string;
let chapterId: string;

/** FREE_TRIAL's `COMMAND` cap (PRD §11.3). */
const CAP = 2;

const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

async function setChapter(content: unknown[]): Promise<void> {
  await h.prisma.chapter.update({
    where: { id: chapterId },
    data: { content: { type: 'doc', content } as Prisma.InputJsonValue },
  });
}

/** Each top-level block's range in the saved chapter: what the block handle sends (R26). */
const rangesOf = (content: unknown[]) =>
  blocksOf({ type: 'doc', content }).map(({ from, to }) => ({ from, to }));

async function commandUnits(): Promise<number> {
  const row = await h.prisma.usageLedger.findFirst({
    where: { userId: h.userId, action: 'COMMAND', period: periodFor() },
  });
  return row?.count ?? 0;
}

async function setCommandUnits(count: number): Promise<void> {
  await h.prisma.usageLedger.upsert({
    where: { userId_period_action: { userId: h.userId, period: periodFor(), action: 'COMMAND' } },
    create: { userId: h.userId, period: periodFor(), action: 'COMMAND', count },
    update: { count },
  });
}

const calls = () => h.prisma.aiCallLog.count({ where: { userId: h.userId, action: 'COMMAND' } });

const proofread = (body: Record<string, unknown>) =>
  h.api('/proofread', { method: 'POST', body: JSON.stringify(body) });

type RunResult = {
  corrections: Array<{ original: string; replacement: string; sentence: string; near: number }>;
  checkedWords: number;
  totalWords: number;
  nextSentence: number | null;
};

beforeAll(async () => {
  h = await startHarness('proofread@example.com');
  const created = await h.api('/documents', {
    method: 'POST',
    body: JSON.stringify({ title: 'Proofread', entryPath: 'A_TOPIC' }),
  });
  const document = (await created.json()) as { id: string; firstChapterId: string };
  documentId = document.id;
  chapterId = document.firstChapterId;
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(async () => {
  await setCommandUnits(0);
});

describe('POST /proofread', () => {
  it('returns corrections as data, for one command unit, and leaves the chapter alone', async () => {
    await setChapter([
      paragraph('The farmers recieved the subsidy late in the season.'),
      paragraph('This sentence has nothing wrong with it.'),
    ]);
    const before = await calls();

    const response = await proofread({ chapterId });
    expect(response.status).toBe(200);
    const result = (await response.json()) as RunResult;
    expect(result.corrections.map((c) => `${c.original}→${c.replacement}`)).toEqual([
      'recieved→received',
    ]);
    expect(result.corrections[0]?.sentence).toBe(
      'The farmers recieved the subsidy late in the season.',
    );
    expect(result.nextSentence).toBeNull();

    expect(await commandUnits()).toBe(1);
    expect(await calls()).toBe(before + 1);
    const chapter = await h.prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    expect(JSON.stringify(chapter.content)).toContain('recieved');
    expect(
      await h.prisma.aiCallLog.count({ where: { documentId, action: 'COMMAND', ok: true } }),
    ).toBeGreaterThan(0);
  });

  it('is refused at the cap, before any model is called', async () => {
    await setChapter([paragraph('The farmers recieved the subsidy late in the season.')]);
    await setCommandUnits(CAP);
    const before = await calls();

    const response = await proofread({ chapterId });
    expect(response.status).toBe(429);
    expect(await calls()).toBe(before);
    expect(await commandUnits()).toBe(CAP);
  });

  it('charges nothing when there is nothing to read', async () => {
    await setChapter([
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '2.1' }] },
    ]);
    const response = await proofread({ chapterId });
    expect(response.status).toBe(200);
    expect(((await response.json()) as RunResult).checkedWords).toBe(0);
    expect(await commandUnits()).toBe(0);
  });

  it('does not read a pending AI draft, which is not the student’s text yet', async () => {
    await setChapter([
      paragraph('This sentence has nothing wrong with it.'),
      {
        type: 'draftBlock',
        attrs: { draftId: '00000000-0000-7000-8000-000000000001' },
        content: [paragraph('The draft recieved no review before it was inserted.')],
      },
    ]);
    const response = await proofread({ chapterId });
    expect(response.status).toBe(200);
    const result = (await response.json()) as RunResult;
    expect(result.corrections).toEqual([]);
    expect(result.totalWords).toBe(7);
  });

  it('reads a long chapter in parts, each saying where the next starts', async () => {
    // About 3,000 words: more than one run reads, with the misspelling near the end.
    const filler =
      'Adoption was slower in the northern districts, where the subsidy arrived months after planting had begun.';
    const paragraphs = Array.from({ length: 190 }, (_, i) => paragraph(`${filler} (${i + 1})`));
    paragraphs.push(paragraph('In the end the farmers recieved the subsidy.'));
    await setChapter(paragraphs);

    const first = (await (await proofread({ chapterId })).json()) as RunResult;
    expect(first.checkedWords).toBeLessThanOrEqual(2_000);
    expect(first.totalWords).toBeGreaterThan(2_000);
    expect(first.nextSentence).not.toBeNull();
    expect(first.corrections).toEqual([]);

    const second = (await (
      await proofread({ chapterId, fromSentence: first.nextSentence })
    ).json()) as RunResult;
    expect(second.nextSentence).toBeNull();
    expect(first.checkedWords + second.checkedWords).toBe(first.totalWords);
    expect(second.corrections.map((c) => c.original)).toEqual(['recieved']);
    // Two runs, two units.
    expect(await commandUnits()).toBe(2);
  });

  it('reads only the paragraph given as a range, for one command unit (R26)', async () => {
    const content = [
      paragraph('The farmers recieved the subsidy late in the season.'),
      paragraph('Dealers described a difficult enviroment for selling drip kits.'),
    ];
    await setChapter(content);
    const second = rangesOf(content)[1];
    // ProseMirror's own accounting: the first paragraph's 52 letters and its two tokens.
    expect(second).toEqual({ from: 54, to: 54 + 63 + 2 });
    const before = await calls();

    const response = await proofread({ chapterId, range: second });
    expect(response.status).toBe(200);
    const result = (await response.json()) as RunResult;
    // The first paragraph's misspelling is not read; the second's is.
    expect(result.corrections.map((c) => `${c.original}→${c.replacement}`)).toEqual([
      'enviroment→environment',
    ]);
    expect(result.corrections[0]?.near).toBeGreaterThan(54);
    expect(result.totalWords).toBe(9);
    expect(result.checkedWords).toBe(9);
    expect(result.nextSentence).toBeNull();
    expect(await commandUnits()).toBe(1);
    expect(await calls()).toBe(before + 1);
  });

  it('refuses a range holding no sentence of the student’s own, before any unit (R26)', async () => {
    const content = [
      paragraph('The farmers recieved the subsidy late in the season.'),
      {
        type: 'draftBlock',
        attrs: { draftId: '00000000-0000-7000-8000-000000000002' },
        content: [paragraph('The draft recieved no review before it was inserted.')],
      },
    ];
    await setChapter(content);
    const before = await calls();
    const draft = rangesOf(content)[1] as { from: number; to: number };

    for (const range of [draft, { from: draft.to + 10, to: draft.to + 40 }]) {
      const response = await proofread({ chapterId, range });
      expect(response.status).toBe(400);
    }
    // A range that ends before it starts is not a range.
    expect((await proofread({ chapterId, range: { from: 20, to: 5 } })).status).toBe(400);
    expect(await commandUnits()).toBe(0);
    expect(await calls()).toBe(before);
  });

  it('refuses a request without a chapter', async () => {
    const response = await proofread({});
    expect(response.status).toBe(400);
    expect(await commandUnits()).toBe(0);
  });
});
