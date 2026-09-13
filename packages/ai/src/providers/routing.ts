/**
 * Which vendor serves a model, and how to run two of them at once — ADR-0011.
 *
 * The product runs a cheap model on the fast tier and a capable one on the strong tier, and since
 * ADR-0011 those can come from different vendors. Two small pieces make that work without any call
 * site learning about it.
 */

import type { z } from 'zod';
import type { LlmChunk, LlmProvider, LlmRequest, LlmResult, Tier } from '../types.js';

export type Vendor = 'anthropic' | 'openai';

/**
 * The vendor that serves `modelId`.
 *
 * Derived from the id rather than configured separately, because the id already determines it —
 * no vendor but OpenAI serves `gpt-5-nano`. A separate `AI_FAST_PROVIDER` variable could disagree
 * with `AI_FAST_MODEL`, and the failure that produces is a 404 from the wrong vendor rather than
 * anything that says which of the two the operator meant. Deriving makes that unrepresentable.
 *
 * Unknown ids fall to `anthropic`: it is the default provider, and a wrong guess here surfaces
 * immediately as `pnpm ai:verify` failing on a model the vendor does not recognise (§0.3 rule 4 —
 * the script exists to catch exactly this).
 */
export function providerForModel(modelId: string): Vendor {
  const id = modelId.trim().toLowerCase();
  if (id.startsWith('gpt-') || id.startsWith('o1') || id.startsWith('o3') || id.startsWith('o4')) {
    return 'openai';
  }
  return 'anthropic';
}

/**
 * One `LlmProvider` over two, chosen by the request's tier.
 *
 * Every metered action already declares its tier (`ACTION_PROFILES`), so this needs no new
 * information — it reads the field the request was always carrying. Callers keep depending only on
 * `LlmProvider` and never learn there are two vendors behind it (PRD §0.2).
 */
export class TieredLlmProvider implements LlmProvider {
  constructor(private readonly byTier: Readonly<Record<Tier, LlmProvider>>) {}

  modelIdFor(tier: Tier): string {
    return this.byTier[tier].modelIdFor(tier);
  }

  stream(req: LlmRequest): AsyncIterable<LlmChunk> {
    return this.byTier[req.tier].stream(req);
  }

  complete<T>(req: LlmRequest & { schema: z.ZodType<T> }): Promise<LlmResult<T>> {
    return this.byTier[req.tier].complete(req);
  }
}
