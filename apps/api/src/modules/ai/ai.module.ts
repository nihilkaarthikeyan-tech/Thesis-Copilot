/**
 * Provider wiring — PRD §10.2. The rest of the API sees `LlmProvider` / `EmbeddingProvider`
 * and never learns which implementation is behind them (PRD §0.2).
 *
 * With `AI_PROVIDER=mock` the mock streams a fixed three-sentence academic paragraph containing a
 * `{{cite:S1#c1}}` marker at `AI_MOCK_LATENCY_MS` (default 250 ms, the PRD §16 week-1 figure) so
 * the editor spike, the k6 load test and every integration test exercise the real transport.
 */

import { Global, Module } from '@nestjs/common';
import {
  createProviders,
  type LlmRequest,
  MockEmbeddingProvider,
  MockLlmProvider,
  mockChatFor,
  mockCiteParseResponse,
  mockCiteResponse,
  mockCiteRoleResponse,
  mockClassifyResponse,
  mockCommandResponse,
  mockProofreadResponse,
  mockProposalFor,
  mockRevisionFor,
  mockSectionScopeResponse,
  mockStyleResponse,
  mockVivaFeedbackResponse,
  mockVivaQuestionsResponse,
  type Providers,
} from '@tc/ai';
import type { Env } from '@tc/config';
import { ENV } from '../../common/env.token.js';

export const PROVIDERS = Symbol('PROVIDERS');

/** Three sentences, one citation marker, ~40 tokens — what the week-1 spike streams. */
export const MOCK_SUGGESTION =
  'Evidence from rural Karnataka indicates that upfront cost, rather than awareness, was the main ' +
  'barrier households reported {{cite:S1#c1}}. This pattern is consistent with findings from ' +
  'comparable districts. The following section therefore examines cost-related barriers before ' +
  'turning to policy responses.';

/**
 * The mock behaves the way A.0 rule 3 asks a real model to: it cites a passage only when one is
 * in the request, using the id shown on it. With no passages the same sentence is written
 * without a citation, so the §10.6 whitelist has nothing to strip and a library-less document
 * still gets a suggestion. Sentence three is left in so the A.1 two-sentence cut is exercised.
 */
export function mockSuggestionFor(req: LlmRequest): string {
  const user = req.messages.find((m) => m.role === 'user')?.content ?? '';
  const firstPassage = /<passage id="([^"]+)"/.exec(user)?.[1];
  return firstPassage
    ? MOCK_SUGGESTION.replace('{{cite:S1#c1}}', `{{cite:${firstPassage}}}`)
    : MOCK_SUGGESTION.replace(' {{cite:S1#c1}}', '');
}

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
              // A.3 is a structured call, so the mock answers it from the passages in its own
              // prompt rather than the default text (which is A.1's streamed paragraph).
              responses: [
                {
                  match: (req: LlmRequest) => req.action === 'CITE',
                  respond: mockCiteResponse,
                },
                // FR-5.5: a pasted reference is parsed by the same shaped answer the real model
                // gives, so the verify-then-insert path is exercisable without a key.
                mockCiteParseResponse,
                // A.13: a guide's comment is classified from the verbs it uses (D.2.3).
                mockClassifyResponse,
                // FR-3.6: one chapter's scope note, rewritten from its own title and siblings.
                mockSectionScopeResponse,
                // FR-5.6 is also a COMMAND call; it is matched first by its `<target>` block.
                mockCiteRoleResponse,
                // ADR-0026: proofreading is metered as COMMAND too; matched by `<proofread>`.
                mockProofreadResponse,
                // ADR-0030: viva preparation, its own action; matched by its outer tag.
                mockVivaQuestionsResponse,
                mockVivaFeedbackResponse,
                mockCommandResponse,
                mockStyleResponse,
                {
                  // Only the mock knows this string; it lets a browser test force the
                  // provider-error state (PHASES 5.2) without a real outage.
                  match: (req: LlmRequest) =>
                    req.messages.some((m) => m.content.includes('[[mock:error]]')),
                  error: 'forced provider failure (mock)',
                },
              ],
              latencyMs: env.AI_MOCK_LATENCY_MS,
              // ~24 chars per chunk at 10 ms apart: the whole suggestion arrives in ~150 ms after TTFB.
              chunkSize: 24,
              chunkDelayMs: 10,
              // A PROPOSAL request (A.6) is answered from the conversation itself: a narrowing
              // question, then a skeleton in the student's own words (PHASES 6.1).
              defaultText: (req) => {
                if (req.action === 'PROPOSAL') return mockProposalFor(req);
                // A.4: answered from the passages in the request, or the exact "not enough" reply.
                if (req.action === 'CHAT') return mockChatFor(req);
                // A.14: keeps the passage and says what the student must supply, which is what
                // the prompt tells a real model to do when the thesis lacks the answer (D.2.3).
                if (req.action === 'SCOPED_REVISION') return mockRevisionFor(req);
                return mockSuggestionFor(req);
              },
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
