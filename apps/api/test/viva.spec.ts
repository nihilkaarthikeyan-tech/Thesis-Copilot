/**
 * Viva preparation through its real HTTP path — ADR-0030.
 *
 * The cap test every metered action has: a question set and an answer's feedback are one `VIVA`
 * unit each, charged before the model is called, and at the cap the refusal comes with no call
 * made. Around it: a thesis too short to examine costs nothing; the questions are about the
 * student's own paragraphs, never a pending AI draft; and the chapter is never touched. Another
 * student's view of them is a 404 — `authz.spec.ts`.
 */

import type { Prisma } from '@tc/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { periodFor } from '../src/modules/usage/usage.service.js';
import { selectVivaPassages } from '../src/modules/viva/passages.js';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let documentId: string;
let chapterId: string;

/** FREE_TRIAL's `VIVA` cap (ADR-0030). */
const CAP = 3;

const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

const PARAGRAPHS = [
  'Forty-two households in three districts of rural Karnataka were interviewed between March and June 2021, chosen from installer enquiry lists so that every one of them had at least considered rooftop solar before.',
  'Upfront cost was named first by most households that stopped, but the interviews show that the fourteen-week wait for the subsidy payment mattered more than its size, because families had to borrow for the whole amount.',
  'Trust in the installer decided more cases than price did: where no installer kept a local service presence, households that had enquired rarely went ahead, whatever subsidy they were offered by the state.',
  'The study therefore argues that faster disbursement and a local service presence would do more for adoption than a larger subsidy, although the sample is small and drawn only from households that enquired.',
];

async function setChapter(content: unknown[]): Promise<void> {
  await h.prisma.chapter.update({
    where: { id: chapterId },
    data: { content: { type: 'doc', content } as Prisma.InputJsonValue },
  });
}

async function vivaUnits(): Promise<number> {
  const row = await h.prisma.usageLedger.findFirst({
    where: { userId: h.userId, action: 'VIVA', period: periodFor() },
  });
  return row?.count ?? 0;
}

async function setVivaUnits(count: number): Promise<void> {
  await h.prisma.usageLedger.upsert({
    where: { userId_period_action: { userId: h.userId, period: periodFor(), action: 'VIVA' } },
    create: { userId: h.userId, period: periodFor(), action: 'VIVA', count },
    update: { count },
  });
}

const calls = () => h.prisma.aiCallLog.count({ where: { userId: h.userId, action: 'VIVA' } });

type View = {
  setId: string | null;
  questions: Array<{
    id: string;
    question: string;
    passage: string;
    chapterId: string;
    from?: number;
    to?: number;
    feedback: { verdict: string; gaps: string[]; thesisSays: Array<{ quote: string }> } | null;
  }>;
};

beforeAll(async () => {
  h = await startHarness('viva@example.com');
  const created = await h.api('/documents', {
    method: 'POST',
    body: JSON.stringify({ title: 'Viva', entryPath: 'A_TOPIC' }),
  });
  const document = (await created.json()) as { id: string; firstChapterId: string };
  documentId = document.id;
  chapterId = document.firstChapterId;
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(async () => {
  await setVivaUnits(0);
});

describe('viva questions', () => {
  it('asks about the student’s own paragraphs, for one unit, and leaves the chapter alone', async () => {
    await setChapter([
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Findings' }] },
      ...PARAGRAPHS.map(paragraph),
      // A pending AI draft is not the student's text yet (FR-4.10): never examined on.
      {
        type: 'draftBlock',
        content: [
          paragraph(
            'DRAFTTEXT this paragraph was written by the model and has not been accepted by the student in any way at all yet.',
          ),
        ],
      },
    ]);
    const before = await calls();
    const saved = await h.prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });

    const response = await h.api(`/viva/${documentId}/questions`, { method: 'POST', body: '{}' });
    expect(response.status).toBe(200);
    const view = (await response.json()) as View;
    expect(view.questions.length).toBeGreaterThanOrEqual(3);
    for (const question of view.questions) {
      expect(PARAGRAPHS.some((p) => p.startsWith(question.passage.replace(/…$/, '')))).toBe(true);
      expect(question.passage).not.toContain('DRAFTTEXT');
      // Fresh: the link can select the paragraph.
      expect(question.from).toBeTypeOf('number');
    }

    expect(await vivaUnits()).toBe(1);
    expect(await calls()).toBe(before + 1);
    const after = await h.prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    expect(after.version).toBe(saved.version);

    // And the page reads it back.
    const read = (await (await h.api(`/documents/${documentId}/viva`)).json()) as View;
    expect(read.setId).toBe(view.setId);
  });

  it('is refused at the cap, before any model is called', async () => {
    await setChapter(PARAGRAPHS.map(paragraph));
    await setVivaUnits(CAP);
    const before = await calls();
    const response = await h.api(`/viva/${documentId}/questions`, { method: 'POST', body: '{}' });
    expect(response.status).toBe(429);
    expect(await calls()).toBe(before);
    expect(await vivaUnits()).toBe(CAP);
  });

  it('charges nothing for a thesis too short to be examined on', async () => {
    await setChapter([paragraph(PARAGRAPHS[0] as string)]);
    const response = await h.api(`/viva/${documentId}/questions`, { method: 'POST', body: '{}' });
    expect(response.status).toBe(400);
    expect(await vivaUnits()).toBe(0);
  });
});

describe('viva answers', () => {
  it('judges a typed answer for one unit, quoting only the thesis’s own words', async () => {
    await setChapter(PARAGRAPHS.map(paragraph));
    const view = (await (
      await h.api(`/viva/${documentId}/questions`, { method: 'POST', body: '{}' })
    ).json()) as View;
    const question = view.questions[0];
    if (!question) throw new Error('no question');
    await setVivaUnits(0);

    const response = await h.api(`/viva/questions/${question.id}/answer`, {
      method: 'POST',
      body: JSON.stringify({
        answer:
          'We used the installer lists because every household on them had considered solar, so they could tell us why they stopped. It does mean we never hear from households that did not enquire at all, which limits how far the findings travel.',
      }),
    });
    expect(response.status).toBe(200);
    const answered = (await response.json()) as View['questions'][number];
    expect(answered.feedback?.verdict).toMatch(/^(strong|partial|weak)$/);
    for (const said of answered.feedback?.thesisSays ?? []) {
      expect(PARAGRAPHS.join(' ')).toContain(said.quote);
    }
    expect(await vivaUnits()).toBe(1);
  });

  it('is refused at the cap, and asks for a real answer without charging', async () => {
    const view = (await (await h.api(`/documents/${documentId}/viva`)).json()) as View;
    const question = view.questions[0];
    if (!question) throw new Error('no question');

    const short = await h.api(`/viva/questions/${question.id}/answer`, {
      method: 'POST',
      body: JSON.stringify({ answer: 'Not sure.' }),
    });
    expect(short.status).toBe(400);
    expect(await vivaUnits()).toBe(0);

    await setVivaUnits(CAP);
    const before = await calls();
    const refused = await h.api(`/viva/questions/${question.id}/answer`, {
      method: 'POST',
      body: JSON.stringify({
        answer: 'Because the lists were the only record of who had enquired.',
      }),
    });
    expect(refused.status).toBe(429);
    expect(await calls()).toBe(before);
  });
});

describe('which paragraphs are examined', () => {
  it('spreads the passages across chapters rather than taking the first one’s', () => {
    const long = (n: number) =>
      Array.from({ length: 30 }, (_, i) =>
        paragraph(`${PARAGRAPHS[i % PARAGRAPHS.length]} Chapter ${n}, paragraph ${i}.`),
      );
    const passages = selectVivaPassages([
      { id: 'a', title: 'One', order: 1, content: { type: 'doc', content: long(1) } },
      { id: 'b', title: 'Two', order: 2, content: { type: 'doc', content: long(2) } },
    ]);
    expect(passages).toHaveLength(20);
    expect(passages.filter((p) => p.chapterId === 'a')).toHaveLength(10);
    expect(passages.filter((p) => p.chapterId === 'b')).toHaveLength(10);
  });
});
