/**
 * Path A conversation — PRD FR-1.5, PHASES 6.1, ADR-0005.
 *
 * Through the real route against the mock provider: three questions, a skeleton the student
 * can edit, the gap check after the first answer, the fourth question blocked in code, every
 * call logged under PROPOSAL, and the conversation closed once it has produced a skeleton.
 */

import { MOCK_KEEP_ASKING } from '@tc/ai';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;

type View = {
  visible: Array<{ role: 'user' | 'assistant'; text: string }>;
  gapCheck: { count: number; works: Array<{ title: string; year: number | null }> } | null;
  skeleton: {
    workingTitle: string;
    problemStatement: string;
    objectives: string[];
    whyOpen: string;
  } | null;
  questionsAsked: number;
  maxQuestions: number;
  modelTurns: number;
  done: boolean;
};

async function newTopicDocument(title: string): Promise<string> {
  const created = await h.api('/documents', {
    method: 'POST',
    body: JSON.stringify({ title, entryPath: 'A_TOPIC' }),
  });
  return ((await created.json()) as { id: string }).id;
}

async function say(documentId: string, message: string): Promise<{ status: number; view: View }> {
  const response = await h.api(`/documents/${documentId}/proposal`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
  return { status: response.status, view: (await response.json()) as View };
}

beforeAll(async () => {
  h = await startHarness('path-a@example.com');
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

describe('POST /documents/:id/proposal', () => {
  it('asks one question per turn and ends in an editable skeleton after the third answer', async () => {
    const id = await newTopicDocument('Drip irrigation');

    const t1 = await say(id, 'Drip irrigation uptake among smallholders in Tamil Nadu');
    expect(t1.status).toBe(200);
    expect(t1.view.visible.at(-1)?.role).toBe('assistant');
    expect(t1.view.visible.at(-1)?.text).toMatch(/\?$/);
    expect(t1.view.questionsAsked).toBe(1);
    expect(t1.view.done).toBe(false);
    // FR-1.5 AC: "no skeleton is generated before at least one clarification turn".
    expect(t1.view.skeleton).toBeNull();
    // The gap check comes after turn 1, not with it.
    expect(t1.view.gapCheck).toBeNull();

    const t2 = await say(id, 'Technology adoption');
    expect(t2.view.questionsAsked).toBe(2);
    // FR-1.5: "runs an early OpenAlex gap-check on the clarified topic" — shape is asserted;
    // the count is whatever the live index says today (0 when the network is down).
    expect(t2.view.gapCheck).not.toBeNull();
    expect(typeof t2.view.gapCheck?.count).toBe('number');
    expect(Array.isArray(t2.view.gapCheck?.works)).toBe(true);

    const t3 = await say(id, 'Two districts');
    expect(t3.view.questionsAsked).toBe(3);
    expect(t3.view.done).toBe(false);

    const t4 = await say(id, 'A survey I run myself');
    expect(t4.status).toBe(200);
    expect(t4.view.done).toBe(true);
    expect(t4.view.skeleton?.workingTitle).toBe(
      'Drip irrigation uptake among smallholders in Tamil Nadu',
    );
    expect(t4.view.skeleton?.objectives.length).toBeGreaterThan(0);
    // The skeleton block itself is not shown as a chat bubble.
    expect(t4.view.visible.every((m) => !m.text.includes('<skeleton>'))).toBe(true);

    // A reload gets the same conversation back.
    const reload = (await (await h.api(`/documents/${id}/proposal`)).json()) as View;
    expect(reload.done).toBe(true);
    // Four student messages and three questions; the skeleton is data, not a bubble.
    expect(reload.visible).toHaveLength(7);

    // Nothing reached DocumentMemory.scope: the student saves the skeleton, not the model.
    const memory = await h.prisma.documentMemory.findUniqueOrThrow({ where: { documentId: id } });
    expect(memory.scope).toEqual({});

    // Every model turn is logged under its own action (ADR-0005), never CHAT.
    const calls = await h.prisma.aiCallLog.findMany({ where: { documentId: id } });
    expect(calls.map((c) => c.action)).toEqual(['PROPOSAL', 'PROPOSAL', 'PROPOSAL', 'PROPOSAL']);
    expect(calls.every((c) => c.ok)).toBe(true);
  });

  it('blocks a fourth question: the server sends the skeleton instruction in the student’s place', async () => {
    const id = await newTopicDocument('Keeps asking');
    await say(id, `Rooftop solar in Karnataka ${MOCK_KEEP_ASKING}`);
    await say(id, 'adoption');
    const t3 = await say(id, 'one district');
    expect(t3.view.questionsAsked).toBe(3);

    // The mock would ask a fourth; the student never sees it.
    const t4 = await say(id, 'a survey');
    expect(t4.status).toBe(200);
    expect(t4.view.done).toBe(true);
    expect(t4.view.questionsAsked).toBe(3);
    expect(t4.view.visible.filter((m) => m.role === 'assistant')).toHaveLength(3);
    expect(t4.view.skeleton?.workingTitle).toContain('Rooftop solar in Karnataka');
    // Two model turns for that last message: the blocked one and the forced one.
    expect(t4.view.modelTurns).toBe(5);
  });

  it('refuses further turns once the skeleton exists, with 409', async () => {
    const id = await newTopicDocument('Done');
    await say(id, 'topic');
    await say(id, 'a');
    await say(id, 'b');
    await say(id, 'c');
    const again = await say(id, 'one more');
    expect(again.status).toBe(409);
  });

  it('is the owner’s conversation only, and needs a message', async () => {
    const id = await newTopicDocument('Private');
    const empty = await h.api(`/documents/${id}/proposal`, {
      method: 'POST',
      body: JSON.stringify({ message: '   ' }),
    });
    expect(empty.status).toBe(400);
    const anonymous = await fetch(`${h.baseUrl}/api/v1/documents/${id}/proposal`);
    expect(anonymous.status).toBe(401);
  });
});
