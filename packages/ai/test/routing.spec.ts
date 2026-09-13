/**
 * Per-tier provider routing — ADR-0011.
 *
 * The reason the vendor is derived from the model id rather than configured beside it is that the
 * two can disagree, and the failure that produces is a 404 from the wrong vendor. So the thing
 * worth testing is that the derivation covers what will actually be typed into `.env`, and that
 * the router sends each tier where its own id points.
 */

import { describe, expect, it, vi } from 'vitest';
import { providerForModel, TieredLlmProvider } from '../src/providers/routing.js';
import type { LlmChunk, LlmProvider, LlmRequest } from '../src/types.js';

describe('which vendor serves a model', () => {
  it('routes the OpenAI ids the pricing table carries', () => {
    for (const id of [
      'gpt-5-nano',
      'gpt-4.1-nano',
      'gpt-4o-mini',
      'gpt-5-mini',
      'gpt-5.4-nano',
      'gpt-5.4-mini',
    ]) {
      expect(providerForModel(id), id).toBe('openai');
    }
  });

  it('routes the Claude ids we run', () => {
    for (const id of ['claude-haiku-4-5-20251001', 'claude-sonnet-5', 'claude-opus-5']) {
      expect(providerForModel(id), id).toBe('anthropic');
    }
  });

  it('routes the o-series, which does not start with gpt-', () => {
    for (const id of ['o1', 'o3-mini', 'o4-mini']) {
      expect(providerForModel(id), id).toBe('openai');
    }
  });

  it('is not fooled by case or stray whitespace in a .env value', () => {
    expect(providerForModel('  GPT-5-Nano  ')).toBe('openai');
    expect(providerForModel('Claude-Sonnet-5')).toBe('anthropic');
  });

  it('falls back to Anthropic for an id it does not recognise', () => {
    // Deliberate: Anthropic is the default provider, and a wrong guess here fails loudly at
    // `pnpm ai:verify` rather than quietly at runtime.
    expect(providerForModel('some-future-model')).toBe('anthropic');
  });
});

/** A provider that records what it was asked for and answers with its own name. */
function fake(name: string): LlmProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    modelIdFor: (tier) => `${name}-${tier}`,
    async *stream(req: LlmRequest): AsyncIterable<LlmChunk> {
      calls.push(`stream:${req.tier}`);
      yield { type: 'text', text: name };
      yield {
        type: 'finish',
        usage: { inputTokens: 1, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 1 },
        modelId: name,
        finishReason: 'stop',
      };
    },
    async complete(req) {
      calls.push(`complete:${req.tier}`);
      return {
        value: name as never,
        usage: { inputTokens: 1, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 1 },
        modelId: name,
      };
    },
  };
}

const request = (tier: 'fast' | 'strong'): LlmRequest => ({
  tier,
  system: { cached: 'x' },
  messages: [{ role: 'user', content: 'y' }],
  maxTokens: 5,
  action: 'ASSIST',
  userId: 'u',
});

describe('the router', () => {
  it('sends each tier to its own provider', async () => {
    const fast = fake('fast-vendor');
    const strong = fake('strong-vendor');
    const llm = new TieredLlmProvider({ fast, strong });

    for await (const _ of llm.stream(request('fast'))) {
      // drained
    }
    for await (const _ of llm.stream(request('strong'))) {
      // drained
    }

    expect(fast.calls).toEqual(['stream:fast']);
    expect(strong.calls).toEqual(['stream:strong']);
  });

  it('routes structured calls by tier too', async () => {
    const fast = fake('fast-vendor');
    const strong = fake('strong-vendor');
    const llm = new TieredLlmProvider({ fast, strong });

    const schema = { safeParse: vi.fn(() => ({ success: true, data: 'ok' })) } as never;
    await llm.complete({ ...request('strong'), schema });

    expect(strong.calls).toEqual(['complete:strong']);
    expect(fast.calls).toEqual([]);
  });

  it('reports each tier’s model id from the provider that serves it', () => {
    const llm = new TieredLlmProvider({ fast: fake('openai'), strong: fake('anthropic') });
    expect(llm.modelIdFor('fast')).toBe('openai-fast');
    expect(llm.modelIdFor('strong')).toBe('anthropic-strong');
  });
});
