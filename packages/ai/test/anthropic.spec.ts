/**
 * The Anthropic adapter — PRD §7.2 (the one file allowed to import a vendor SDK) and §10.3
 * (prompt caching on the cached half of the system block only).
 *
 * These tests exist because of a defect they would have caught. Until 2026-09-08 every AI call in
 * the product went to the mock provider, this adapter had no test, and it put its system blocks
 * inside `messages`. The AI SDK v7 refuses that — "System messages are not allowed in the prompt
 * or messages fields" — so the first real provider call, made by `pnpm ai:verify` the moment a key
 * existed, failed. Every Assist, draft, chat and command in production would have failed the same
 * way.
 *
 * So what is asserted here is the request body that actually goes over the wire, captured through
 * the SDK's own documented `fetch` injection point. Asserting on our own arguments would have
 * proved nothing: the arguments looked right, and the SDK rejected them.
 */

import { describe, expect, it } from 'vitest';
import { AnthropicLlmProvider } from '../src/providers/anthropic.js';
import { LlmProviderError, type LlmRequest } from '../src/types.js';

/** The Anthropic messages-API body, in the parts these tests read. */
type WireBody = {
  model: string;
  max_tokens: number;
  temperature?: number;
  system: Array<{ type: string; text: string; cache_control?: { type: string } }>;
  messages: Array<{ role: string; content: unknown }>;
};

/**
 * Runs the adapter against a fetch that records the request and refuses it, and returns the body.
 *
 * The refusal is the point: a valid Anthropic streaming response would have to be fabricated, and
 * §0.3 rule 1 forbids inventing a wire format. What is under test is what we send, which is
 * captured before the status code matters. 400 rather than 500 so the SDK does not retry.
 */
async function capture(
  request: LlmRequest,
  how: 'stream' | 'complete' = 'stream',
): Promise<WireBody> {
  let body: WireBody | null = null;
  const provider = new AnthropicLlmProvider({
    apiKey: 'test-key',
    fastModel: 'fast-model-id',
    strongModel: 'strong-model-id',
    fetch: (async (_url: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as WireBody;
      return new Response('{"type":"error"}', { status: 400 });
    }) as typeof globalThis.fetch,
  });

  await expect(async () => {
    if (how === 'complete') {
      const { z } = await import('zod');
      await provider.complete({ ...request, schema: z.object({ text: z.string() }) });
      return;
    }
    for await (const _chunk of provider.stream(request)) {
      // drained; the call fails before any chunk arrives
    }
  }).rejects.toThrow(LlmProviderError);

  if (!body) throw new Error('no request was sent');
  return body;
}

const request = (over: Partial<LlmRequest> = {}): LlmRequest => ({
  tier: 'fast',
  system: { cached: 'CACHED PREFIX', volatile: 'VOLATILE HALF' },
  messages: [{ role: 'user', content: 'hello' }],
  maxTokens: 5,
  action: 'ASSIST',
  userId: 'u1',
  ...over,
});

describe('the request that reaches the provider', () => {
  it('sends the system blocks as system, never inside messages', async () => {
    // The regression. A system entry in `messages` is rejected outright by the SDK.
    const body = await capture(request());

    expect(body.system.map((part) => part.text)).toEqual(['CACHED PREFIX', 'VOLATILE HALF']);
    expect(body.messages.map((message) => message.role)).toEqual(['user']);
    expect(body.messages.some((message) => message.role === 'system')).toBe(false);
  });

  it('marks only the cached half for caching (§10.3)', async () => {
    // A cache marker on the volatile half would invalidate the prefix on every changed chapter or
    // newly retrieved passage, which is the entire saving the §11 budget assumes.
    const body = await capture(request());

    expect(body.system[0]?.cache_control).toEqual({ type: 'ephemeral' });
    expect(body.system[1]?.cache_control).toBeUndefined();
  });

  it('sends one system block when there is no volatile half', async () => {
    const body = await capture(request({ system: { cached: 'ONLY CACHED' } }));

    expect(body.system).toHaveLength(1);
    expect(body.system[0]?.text).toBe('ONLY CACHED');
    expect(body.system[0]?.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('carries the conversation turns in order', async () => {
    const body = await capture(
      request({
        messages: [
          { role: 'user', content: 'first' },
          { role: 'assistant', content: 'second' },
          { role: 'user', content: 'third' },
        ],
      }),
    );

    expect(body.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
  });

  it('sends the tier’s model id and the token cap', async () => {
    expect((await capture(request({ tier: 'fast' }))).model).toBe('fast-model-id');
    expect((await capture(request({ tier: 'strong' }))).model).toBe('strong-model-id');
    expect((await capture(request({ maxTokens: 64 }))).max_tokens).toBe(64);
  });

  it('passes a temperature only when one was asked for', async () => {
    expect((await capture(request({ temperature: 0.2 }))).temperature).toBe(0.2);
    expect((await capture(request())).temperature).toBeUndefined();
  });
});

describe('the structured call takes the same path', () => {
  it('also sends its system blocks as system, with the cache marker', async () => {
    // `complete()` had the identical defect; it is a separate call site into the SDK.
    const body = await capture(request(), 'complete');

    expect(body.system.map((part) => part.text)).toEqual(['CACHED PREFIX', 'VOLATILE HALF']);
    expect(body.system[0]?.cache_control).toEqual({ type: 'ephemeral' });
    expect(body.messages.some((message) => message.role === 'system')).toBe(false);
  });
});
