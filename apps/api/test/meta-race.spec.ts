/**
 * ADR-0091 — a proposal turn and a plan from the title, at the same time.
 *
 * Found in the browser on 2026-10-07: the student pressed "Skip and start writing" while the first
 * start question was still being written. The plan marked itself RUNNING in `Document.meta`, then
 * the question's turn saved the `meta` it had read before — and the mark was gone, so the editor
 * never learnt a plan was coming. Each now sets only its own key (`setMetaKey`).
 */

import type { LlmChunk, Providers } from '@tc/ai';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PROVIDERS } from '../src/modules/ai/ai.module.js';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let providers: Providers;

beforeAll(async () => {
  h = await startHarness('meta-race@example.com');
  providers = h.app.get<Providers>(PROVIDERS);
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

describe('a proposal turn finishing after the plan has started', () => {
  it("keeps the plan's RUNNING mark, and the plan keeps the turn", async () => {
    const created = await h.api('/documents', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Mobile banking adoption among women self-help groups in Tamil Nadu',
        entryPath: 'A_TOPIC',
        start: 'writing',
        structure: 'smart',
        askFirst: true,
      }),
    });
    const { id } = (await created.json()) as { id: string };

    // The question takes a moment to write; the plan is asked for while it does.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(providers.llm, 'stream').mockImplementation(() =>
      (async function* (): AsyncIterable<LlmChunk> {
        await gate;
        yield {
          type: 'text',
          text: 'Is this mainly about adoption, impact or barriers? Options: adoption; impact; barriers; something else.',
        };
        yield {
          type: 'finish',
          usage: { inputTokens: 300, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 30 },
          modelId: 'mock-strong',
          finishReason: 'stop',
        };
      })(),
    );
    const turn = h.api(`/documents/${id}/proposal`, {
      method: 'POST',
      body: JSON.stringify({ message: 'Mobile banking adoption among women SHGs in Tamil Nadu' }),
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const plan = await h.api(`/documents/${id}/outline/plan-from-title`, {
      method: 'POST',
      body: '{}',
    });
    expect(plan.status).toBeLessThan(300);
    release();
    expect((await turn).status).toBe(200);

    const doc = await h.prisma.document.findUnique({ where: { id }, select: { meta: true } });
    const meta = doc?.meta as {
      outlineRun?: { status?: string };
      proposalChat?: { messages?: unknown[] };
    };
    expect(meta.outlineRun?.status).toBe('RUNNING');
    expect(meta.proposalChat?.messages?.length).toBeGreaterThan(0);
  });
});
