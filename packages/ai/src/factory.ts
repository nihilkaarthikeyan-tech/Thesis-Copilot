/**
 * Chooses the provider pair from config. The rest of the app depends on the interfaces in
 * `types.ts` and never learns which implementation it got (PRD §0.2).
 */

import type { Env } from '@tc/config';
import { AnthropicLlmProvider, VoyageEmbeddingProvider } from './providers/anthropic.js';
import { MockEmbeddingProvider, MockLlmProvider } from './providers/mock.js';
import type { EmbeddingProvider, LlmProvider } from './types.js';

export type Providers = {
  readonly llm: LlmProvider;
  readonly embeddings: EmbeddingProvider;
};

export function createProviders(env: Env, mockLatencyMs = 0): Providers {
  const llm: LlmProvider =
    env.AI_PROVIDER === 'mock'
      ? new MockLlmProvider({
          latencyMs: mockLatencyMs,
          modelIds: { fast: env.AI_FAST_MODEL, strong: env.AI_STRONG_MODEL },
        })
      : new AnthropicLlmProvider({
          // Guaranteed present: packages/config refuses to start without it when
          // AI_PROVIDER=anthropic.
          apiKey: env.ANTHROPIC_API_KEY ?? '',
          fastModel: env.AI_FAST_MODEL,
          strongModel: env.AI_STRONG_MODEL,
        });

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
