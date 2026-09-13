/**
 * Chooses the provider pair from config. The rest of the app depends on the interfaces in
 * `types.ts` and never learns which implementation it got (PRD §0.2).
 *
 * Since ADR-0011 the two tiers can come from different vendors — the vendor is derived from each
 * tier's model id, so `AI_FAST_MODEL=gpt-5-nano` is the whole configuration. `AI_PROVIDER=mock`
 * still forces the mock for both tiers, which is what every test relies on.
 */

import type { Env } from '@tc/config';
import { AnthropicLlmProvider, VoyageEmbeddingProvider } from './providers/anthropic.js';
import { MockEmbeddingProvider, MockLlmProvider } from './providers/mock.js';
import { OpenAiLlmProvider } from './providers/openai.js';
import { providerForModel, TieredLlmProvider, type Vendor } from './providers/routing.js';
import type { EmbeddingProvider, LlmProvider } from './types.js';

export type Providers = {
  readonly llm: LlmProvider;
  readonly embeddings: EmbeddingProvider;
};

function realProvider(vendor: Vendor, env: Env): LlmProvider {
  // Both keys are guaranteed present when a model id needs them: `packages/config` refuses to
  // start otherwise, the same way it always has for Anthropic.
  const shared = { fastModel: env.AI_FAST_MODEL, strongModel: env.AI_STRONG_MODEL };
  return vendor === 'openai'
    ? new OpenAiLlmProvider({ apiKey: env.OPENAI_API_KEY ?? '', ...shared })
    : new AnthropicLlmProvider({ apiKey: env.ANTHROPIC_API_KEY ?? '', ...shared });
}

export function createProviders(env: Env, mockLatencyMs = 0): Providers {
  let llm: LlmProvider;

  if (env.AI_PROVIDER === 'mock') {
    llm = new MockLlmProvider({
      latencyMs: mockLatencyMs,
      modelIds: { fast: env.AI_FAST_MODEL, strong: env.AI_STRONG_MODEL },
    });
  } else {
    const fastVendor = providerForModel(env.AI_FAST_MODEL);
    const strongVendor = providerForModel(env.AI_STRONG_MODEL);
    llm =
      fastVendor === strongVendor
        ? // One vendor for both tiers, which is the common case — no need for a router.
          realProvider(fastVendor, env)
        : new TieredLlmProvider({
            fast: realProvider(fastVendor, env),
            strong: realProvider(strongVendor, env),
          });
  }

  const embeddings: EmbeddingProvider =
    env.EMBED_PROVIDER === 'mock'
      ? new MockEmbeddingProvider({
          dims: env.EMBED_DIMS,
          latencyMs: mockLatencyMs,
          modelId: env.AI_EMBED_MODEL,
        })
      : new VoyageEmbeddingProvider({
          apiKey: env.VOYAGE_API_KEY ?? '',
          model: env.AI_EMBED_MODEL,
          dims: env.EMBED_DIMS,
        });

  return { llm, embeddings };
}
