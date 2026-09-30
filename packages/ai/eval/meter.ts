/**
 * What an evaluation run spent, from the providers' own token counts and the product's cost
 * table (`computeCallCost`, the same function `AiCallLog` uses). A call that throws before
 * returning usage is not counted, so a run with failures slightly under-reports.
 */

import { computeCallCost, microToInr } from '@tc/config';
import type { LlmProvider } from '../src/types.js';

export function metered(llm: LlmProvider): { llm: LlmProvider; rupees: () => number } {
  let micro = 0;
  const wrapped: LlmProvider = {
    modelIdFor: (tier) => llm.modelIdFor(tier),
    async *stream(req) {
      for await (const chunk of llm.stream(req)) {
        if (chunk.type === 'finish') {
          micro += computeCallCost({ tier: req.tier, modelId: chunk.modelId, usage: chunk.usage });
        }
        yield chunk;
      }
    },
    async complete(req) {
      const result = await llm.complete(req);
      micro += computeCallCost({ tier: req.tier, modelId: result.modelId, usage: result.usage });
      return result;
    },
  };
  return { llm: wrapped, rupees: () => Math.round(microToInr(micro) * 100) / 100 };
}
