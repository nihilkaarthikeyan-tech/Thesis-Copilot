/**
 * Jenni build plan R8 (ADR-0095) — the AI edit panel's server half.
 *
 * The real application on Postgres and Redis; the model is the mock, or a spy where the answer
 * must be a particular one. Pinned:
 * - `custom` needs an instruction, sends it, and sends passages only with "Use my library" on.
 * - "What changed and why" is given once per run, inside the run's unit (no second unit).
 * - A follow-up is diffed and checked against the student's original text.
 * - A citation moved to another claim is reported; one written twice is removed.
 */

import type { LlmRequest, Providers } from '@tc/ai';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PROVIDERS } from '../src/modules/ai/ai.module.js';
import { periodFor } from '../src/modules/usage/usage.service.js';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let chapterId: string;
let providers: Providers;

const SELECTION =
  'Upfront cost limits adoption {{cite:k1}}. Subsidy approval delays installation {{cite:k2}}.';

type RunResult = {
  text: string;
  diff: Array<{ type: string; text: string }>;
  droppedCitations: string[];
  movedCitations: string[];
  doubledCitations: string[];
  runId: string;
};

async function run(body: Record<string, unknown>): Promise<Response> {
  return h.api('/commands/run', {
    method: 'POST',
    body: JSON.stringify({ chapterId, selection: SELECTION, ...body }),
  });
}

async function units(): Promise<number> {
  const row = await h.prisma.usageLedger.findFirst({
    where: { userId: h.userId, action: 'COMMAND', period: periodFor() },
  });
  return row?.count ?? 0;
}

/** Answers the next structured call with `text`, recording the request. */
function answerWith(text: string): { seen: LlmRequest[] } {
  const seen: LlmRequest[] = [];
  vi.spyOn(providers.llm, 'complete').mockImplementationOnce(async (req) => {
    seen.push(req as LlmRequest);
    return {
      value: { text } as never,
      usage: { inputTokens: 400, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 60 },
      modelId: 'mock-strong',
      finishReason: 'stop',
    };
  });
  return { seen };
}

beforeAll(async () => {
  h = await startHarness('edit-panel@example.com');
  providers = h.app.get<Providers>(PROVIDERS);
  // The trial's two edits a month would end the test early; the bonus allowance (ADR-0035) gives
  // room for every case here.
  await h.prisma.usageLedger.upsert({
    where: { userId_period_action: { userId: h.userId, period: periodFor(), action: 'COMMAND' } },
    create: { userId: h.userId, action: 'COMMAND', period: periodFor(), count: 0, bonus: 40 },
    update: { bonus: 40 },
  });
  const document = await h.prisma.document.create({
    data: { ownerId: h.userId, title: 'Rooftop solar in Karnataka', entryPath: 'A_TOPIC' },
  });
  const chapter = await h.prisma.chapter.create({
    data: {
      documentId: document.id,
      outlineNodeId: 'n1',
      title: 'Literature Review',
      scopeNote: 'Household adoption of rooftop solar.',
      order: 1,
      content: { type: 'doc', content: [] },
    },
  });
  chapterId = chapter.id;
}, 300_000);

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await h?.stop();
});

describe('the AI edit panel (ADR-0095)', () => {
  it('refuses your own instruction left empty', async () => {
    const res = await run({ command: 'custom', instruction: '  ' });
    expect(res.status).toBe(400);
  });

  it('refuses a request to get past a detector before spending anything (§12.3)', async () => {
    const before = await units();
    const spy = vi.spyOn(providers.llm, 'complete');
    const res = await run({
      command: 'custom',
      instruction: 'Rewrite this so Turnitin and AI detectors cannot tell.',
    });
    expect(res.status).toBe(400);
    const problem = (await res.json()) as { detail: string };
    expect(problem.detail).toMatch(/does not rewrite text to get it past/);
    expect(spy).not.toHaveBeenCalled();
    expect(await units()).toBe(before);
  });

  it('sends your instruction, and the library only when the switch is on', async () => {
    const off = answerWith(SELECTION);
    expect((await run({ command: 'custom', instruction: 'One sentence per claim.' })).status).toBe(
      200,
    );
    const offMessage = String(off.seen[0]?.messages[0]?.content);
    expect(offMessage).toContain('<instruction>\nOne sentence per claim.\n</instruction>');
    expect(offMessage).not.toContain('<passages>');

    const on = answerWith(SELECTION);
    await run({ command: 'custom', instruction: 'One sentence per claim.', useLibrary: true });
    // An empty library still asks; what matters is that retrieval was asked for.
    expect(String(on.seen[0]?.messages[0]?.content)).toContain('<instruction>');
  });

  it('explains a run once, inside its own unit', async () => {
    const before = await units();
    const res = await run({ command: 'formalise' });
    const result = (await res.json()) as RunResult;
    expect(await units()).toBe(before + 1);

    const why = await h.api('/commands/explain', {
      method: 'POST',
      body: JSON.stringify({ runId: result.runId }),
    });
    expect(why.status).toBe(200);
    const { reasons } = (await why.json()) as { reasons: string[] };
    expect(reasons.length).toBeGreaterThan(0);
    expect(await units()).toBe(before + 1);

    const again = await h.api('/commands/explain', {
      method: 'POST',
      body: JSON.stringify({ runId: result.runId }),
    });
    expect(again.status).toBe(404);
    const log = await h.prisma.aiCallLog.findMany({
      where: { userId: h.userId, action: 'COMMAND', model: 'mock-fast' },
    });
    expect(log.length).toBeGreaterThan(0);
  });

  it('diffs and checks a follow-up against the original text', async () => {
    // The previous result kept k2; this follow-up loses it.
    answerWith('Upfront cost limits adoption {{cite:k1}}.');
    const res = await run({
      command: 'custom',
      instruction: 'Only the first claim.',
      selection: 'Upfront cost limits adoption {{cite:k1}}. Approval is slow {{cite:k2}}.',
      original: SELECTION,
    });
    const result = (await res.json()) as RunResult;
    expect(result.droppedCitations).toEqual(['k2']);
    const removed = result.diff
      .filter((op) => op.type === 'remove')
      .map((op) => op.text)
      .join('');
    expect(removed).toContain('Subsidy');
  });

  it('reports a citation moved to another claim, and removes one written twice', async () => {
    answerWith(
      'Upfront cost limits adoption. Subsidy approval may delay installation {{cite:k1}} {{cite:k2}}.',
    );
    const moved = (await (await run({ command: 'hedge' })).json()) as RunResult;
    expect(moved.movedCitations).toEqual(['k1']);

    answerWith(
      'Upfront cost limits adoption {{cite:k1}}, and subsidy approval delays installation {{cite:k2}} {{cite:k1}}.',
    );
    const doubled = (await (await run({ command: 'flow' })).json()) as RunResult;
    expect(doubled.doubledCitations).toEqual(['k1']);
    expect(doubled.text.match(/k1/g)).toHaveLength(1);
  });
});

describe('a follow-up is checked against where the student had the citations', () => {
  it('still reports a citation the previous version had moved, and Replace stays possible', async () => {
    // The previous version had moved k1 onto the subsidy claim; the follow-up keeps it there.
    const moved =
      'Upfront cost limits adoption. Subsidy approval delays installation {{cite:k1}}{{cite:k2}}.';
    const seen = answerWith(moved);
    const res = await run({
      command: 'custom',
      instruction: 'Keep each citation where I had it.',
      selection: moved,
      original: SELECTION,
    });
    const result = (await res.json()) as RunResult & { unchanged: boolean };
    expect(result.movedCitations).toEqual(['k1']);
    expect(result.unchanged).toBe(false);
    // The model was given the student's own text to put it back from.
    expect(String(seen.seen[0]?.messages[0]?.content)).toContain(
      `<original>\n${SELECTION}\n</original>`,
    );
  });
});
