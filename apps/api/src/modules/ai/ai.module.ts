/**
 * Provider wiring — PRD §10.2. The rest of the API sees `LlmProvider` / `EmbeddingProvider`
 * and never learns which implementation is behind them (PRD §0.2).
 *
 * With `AI_PROVIDER=mock` the mock streams a fixed three-sentence academic paragraph containing a
 * `{{cite:S1#c1}}` marker at `AI_MOCK_LATENCY_MS` (default 250 ms, the PRD §16 week-1 figure) so
 * the editor spike, the k6 load test and every integration test exercise the real transport.
 */

import { Global, Module } from '@nestjs/common';
import { createProviders, MockEmbeddingProvider, MockLlmProvider, type Providers } from '@tc/ai';
import type { Env } from '@tc/config';
import { ENV } from '../../common/env.token.js';

export const PROVIDERS = Symbol('PROVIDERS');

/** Three sentences, one citation marker, ~40 tokens — what the week-1 spike streams. */
export const MOCK_SUGGESTION =
  'Evidence from rural Karnataka indicates that upfront cost, rather than awareness, was the main ' +
  'barrier households reported {{cite:S1#c1}}. This pattern is consistent with findings from ' +
  'comparable districts. The following section therefore examines cost-related barriers before ' +
  'turning to policy responses.';

@Global()
@Module({
  providers: [
    {
      provide: PROVIDERS,
      inject: [ENV],
      useFactory: (env: Env): Providers => {
        if (env.AI_PROVIDER === 'mock') {
          return {
            llm: new MockLlmProvider({
              latencyMs: env.AI_MOCK_LATENCY_MS,
              // ~24 chars per chunk at 10 ms apart: the whole suggestion arrives in ~150 ms after TTFB.
              chunkSize: 24,
              chunkDelayMs: 10,
              defaultText: MOCK_SUGGESTION,
              modelIds: { fast: env.AI_FAST_MODEL, strong: env.AI_STRONG_MODEL },
            }),
            embeddings: new MockEmbeddingProvider({
              dims: env.EMBED_DIMS,
              modelId: env.AI_EMBED_MODEL,
            }),
          };
        }
        return createProviders(env);
      },
    },
  ],
  exports: [PROVIDERS],
})
export class AiModule {}
