/**
 * Mock provider — PHASES.md task 0.5. Every test and the week-1 editor spike run against this, so
 * its behaviour is itself worth testing.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MockEmbeddingProvider, MockLlmProvider } from '../src/providers/mock.js';
import { LlmProviderError, type LlmRequest, LlmValidationError } from '../src/types.js';

const request = (over: Partial<LlmRequest> = {}): LlmRequest => ({
  tier: 'fast',
  system: { cached: 'cached system block' },
  messages: [{ role: 'user', content: 'hello' }],
  maxTokens: 120,
  action: 'ASSIST',
  userId: 'user-1',
  ...over,
});

async function collect(provider: MockLlmProvider, req: LlmRequest) {
  let text = '';
  let finish: { usage: unknown; modelId: string } | undefined;
  for await (const chunk of provider.stream(req)) {
    if (chunk.type === 'text') text += chunk.text;
    else finish = { usage: chunk.usage, modelId: chunk.modelId };
  }
  return { text, finish };
}

describe('MockLlmProvider.stream', () => {
  it('streams the default text and ends with one finish chunk', async () => {
    const provider = new MockLlmProvider({ defaultText: 'Hello there.' });
    const { text, finish } = await collect(provider, request());

    expect(text).toBe('Hello there.');
    expect(finish?.modelId).toBe('mock-fast');
  });

  it('emits text in chunks, then exactly one finish', async () => {
    const provider = new MockLlmProvider({ defaultText: 'a'.repeat(100), chunkSize: 10 });
    const chunks = [];
    for await (const chunk of provider.stream(request())) chunks.push(chunk);

    expect(chunks.filter((c) => c.type === 'text')).toHaveLength(10);
    expect(chunks.filter((c) => c.type === 'finish')).toHaveLength(1);
    expect(chunks.at(-1)?.type).toBe('finish');
  });

  it('waits the configured latency before the first chunk', async () => {
    // PRD §16 week 1 runs the editor spike at 250 ms simulated latency; use a small value here.
    const provider = new MockLlmProvider({ latencyMs: 60, defaultText: 'x' });
    const started = Date.now();
    const iterator = provider.stream(request())[Symbol.asyncIterator]();
    await iterator.next();
    expect(Date.now() - started).toBeGreaterThanOrEqual(50);
  });

  it('records every request so tests can assert on caps and actions', async () => {
    const provider = new MockLlmProvider();
    await collect(provider, request({ action: 'ASSIST' }));
    await collect(provider, request({ action: 'DRAFT', tier: 'strong' }));

    expect(provider.calls).toHaveLength(2);
    expect(provider.callsFor('DRAFT')).toHaveLength(1);
    expect(provider.calls[1]?.tier).toBe('strong');
  });

  it('reports usage split into uncached, cached and output tokens', async () => {
    const provider = new MockLlmProvider({ defaultText: 'output text' });
    const { finish } = await collect(provider, request());

    expect(finish?.usage).toMatchObject({
      inputTokens: expect.any(Number),
      cachedInputTokens: expect.any(Number),
      outputTokens: expect.any(Number),
    });
  });

  it('honours an explicit usage override', async () => {
    const provider = new MockLlmProvider({
      responses: [
        { text: 'x', usage: { inputTokens: 1200, cachedInputTokens: 4000, outputTokens: 50 } },
      ],
    });
    const { finish } = await collect(provider, request());

    expect(finish?.usage).toMatchObject({
      inputTokens: 1200,
      cachedInputTokens: 4000,
      outputTokens: 50,
    });
  });

  it('picks the first response whose match wins', async () => {
    const provider = new MockLlmProvider({
      responses: [
        { match: (r) => r.action === 'DRAFT', text: 'draft body' },
        { match: (r) => r.action === 'ASSIST', text: 'assist body' },
      ],
    });

    expect((await collect(provider, request({ action: 'ASSIST' }))).text).toBe('assist body');
    expect((await collect(provider, request({ action: 'DRAFT' }))).text).toBe('draft body');
  });

  it('stops when the caller aborts, which is what typing does (Appendix B.3)', async () => {
    const provider = new MockLlmProvider({ chunkSize: 1, chunkDelayMs: 5 });
    const controller = new AbortController();

    let received = 0;
    for await (const chunk of provider.stream(
      request({ signal: controller.signal, messages: [{ role: 'user', content: 'x' }] }),
    )) {
      if (chunk.type === 'text') {
        received++;
        if (received === 3) controller.abort();
      }
    }

    expect(received).toBeLessThan(10);
  });

  it('throws a provider error when the response says to', async () => {
    const provider = new MockLlmProvider({ responses: [{ error: 'upstream 529' }] });
    await expect(collect(provider, request())).rejects.toBeInstanceOf(LlmProviderError);
  });
});

describe('MockLlmProvider.complete', () => {
  const schema = z.object({ title: z.string(), year: z.number() });

  it('validates against the schema and returns the parsed value', async () => {
    const provider = new MockLlmProvider({
      responses: [{ value: { title: 'A paper', year: 2021 } }],
    });
    const result = await provider.complete({ ...request({ action: 'EXTRACT' }), schema });

    expect(result.value).toEqual({ title: 'A paper', year: 2021 });
    expect(result.modelId).toBe('mock-fast');
  });

  it('throws LlmValidationError when the shape is wrong', async () => {
    const provider = new MockLlmProvider({ responses: [{ value: { title: 'A paper' } }] });
    await expect(
      provider.complete({ ...request({ action: 'EXTRACT' }), schema }),
    ).rejects.toBeInstanceOf(LlmValidationError);
  });
});

describe('MockEmbeddingProvider', () => {
  it('returns one vector per input at the configured dimension', async () => {
    const provider = new MockEmbeddingProvider({ dims: 1024 });
    const vectors = await provider.embed(['one', 'two', 'three']);

    expect(vectors).toHaveLength(3);
    expect(vectors[0]).toHaveLength(1024);
  });

  it('is deterministic: the same text always gives the same vector', async () => {
    const a = new MockEmbeddingProvider();
    const b = new MockEmbeddingProvider();

    expect((await a.embed(['retrieval']))[0]).toEqual((await b.embed(['retrieval']))[0]);
  });

  it('gives different texts different vectors', async () => {
    const provider = new MockEmbeddingProvider();
    const [first, second] = await provider.embed(['alpha', 'beta']);
    expect(first).not.toEqual(second);
  });

  it('returns unit vectors, so cosine similarity is a dot product', async () => {
    const provider = new MockEmbeddingProvider({ dims: 256 });
    const [vector] = await provider.embed(['normalise me']);
    const norm = Math.sqrt((vector ?? []).reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1, 6);
  });

  it('handles an empty batch', async () => {
    expect(await new MockEmbeddingProvider().embed([])).toEqual([]);
  });
});
