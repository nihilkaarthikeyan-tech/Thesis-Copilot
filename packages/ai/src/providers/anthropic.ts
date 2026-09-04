/**
 * Anthropic adapter — PRD §7.2 (Vercel AI SDK + `@ai-sdk/anthropic` behind `packages/ai`) and §10.3
 * (prompt caching via `cache_control` on the system block).
 *
 * This is the only file in the repo allowed to import a vendor SDK (PRD §0.2).
 *
 * Model ids are never hardcoded: they come from `AI_FAST_MODEL` / `AI_STRONG_MODEL`, and
 * `pnpm ai:verify` (Appendix E.1) confirms the provider accepts them before the cost model is
 * trusted (§0.3 rule 5).
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { generateObject, type LanguageModel, type LanguageModelUsage, streamText } from 'ai';
import type { z } from 'zod';
import {
  type EmbeddingProvider,
  type LlmChunk,
  type LlmProvider,
  LlmProviderError,
  type LlmRequest,
  type LlmResult,
  LlmValidationError,
  type Tier,
  type TokenUsage,
} from '../types.js';

export type AnthropicProviderOptions = {
  readonly apiKey: string;
  readonly fastModel: string;
  readonly strongModel: string;
  readonly baseURL?: string;
};

/** Maps the SDK's usage shape onto the four numbers `packages/config` prices (PRD §11.5). */
export function toTokenUsage(usage: LanguageModelUsage): TokenUsage {
  const details = usage.inputTokenDetails;
  const cacheRead = details?.cacheReadTokens ?? 0;
  const cacheWrite = details?.cacheWriteTokens ?? 0;
  // `noCacheTokens` is the uncached portion. Fall back to inputTokens minus the cached parts when
  // the provider does not break it down.
  const uncached = details?.noCacheTokens ?? Math.max((usage.inputTokens ?? 0) - cacheRead, 0);

  return {
    inputTokens: uncached,
    cachedInputTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    outputTokens: usage.outputTokens ?? 0,
  };
}

export class AnthropicLlmProvider implements LlmProvider {
  private readonly anthropic: ReturnType<typeof createAnthropic>;
  private readonly models: Record<Tier, string>;

  constructor(options: AnthropicProviderOptions) {
    this.anthropic = createAnthropic({
      apiKey: options.apiKey,
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    });
    this.models = { fast: options.fastModel, strong: options.strongModel };
  }

  modelIdFor(tier: Tier): string {
    return this.models[tier];
  }

  private model(tier: Tier): LanguageModel {
    return this.anthropic(this.models[tier]);
  }

  /**
   * PRD §10.3: only the `cached` half of the system block carries `cache_control`. The volatile half
   * is a second system part with no cache marker, so a changed chapter or a new retrieved passage
   * never invalidates the cached prefix.
   */
  private systemParts(req: LlmRequest) {
    const parts = [
      {
        role: 'system' as const,
        content: req.system.cached,
        providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' as const } } },
      },
    ];
    if (req.system.volatile) {
      parts.push({
        role: 'system' as const,
        content: req.system.volatile,
      } as (typeof parts)[number]);
    }
    return parts;
  }

  private messages(req: LlmRequest) {
    return [
      ...this.systemParts(req),
      ...req.messages.map((m) => ({ role: m.role, content: m.content })),
    ];
  }

  async *stream(req: LlmRequest): AsyncIterable<LlmChunk> {
    let result: ReturnType<typeof streamText>;
    try {
      result = streamText({
        model: this.model(req.tier),
        messages: this.messages(req),
        maxOutputTokens: req.maxTokens,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.signal ? { abortSignal: req.signal } : {}),
        // Same boundary as complete(): the SDK option type is an overloaded intersection that our
        // per-part providerOptions on system messages do not satisfy; validated at runtime.
      } as unknown as Parameters<typeof streamText>[0]);

      for await (const delta of result.textStream) {
        yield { type: 'text', text: delta };
      }
    } catch (cause) {
      throw new LlmProviderError(req.action, 'Anthropic stream failed', cause);
    }

    yield {
      type: 'finish',
      usage: toTokenUsage(await result.usage),
      modelId: this.models[req.tier],
      finishReason: await result.finishReason,
    };
  }

  async complete<T>(req: LlmRequest & { schema: z.ZodType<T> }): Promise<LlmResult<T>> {
    let object: unknown;
    let usage: LanguageModelUsage;

    try {
      // `generateObject`'s return type is conditional on the schema's inferred output, which TS
      // cannot resolve through our generic `z.ZodType<T>`. The options are cast at this one
      // boundary and the result is validated below, so nothing downstream trusts the cast.
      const result = await generateObject({
        model: this.model(req.tier),
        schema: req.schema,
        messages: this.messages(req),
        maxOutputTokens: req.maxTokens,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.signal ? { abortSignal: req.signal } : {}),
      } as unknown as Parameters<typeof generateObject>[0]);

      object = result.object;
      usage = result.usage;
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'AI_NoObjectGeneratedError') {
        throw new LlmValidationError(req.action, cause, cause.message);
      }
      throw new LlmProviderError(req.action, 'Anthropic structured call failed', cause);
    }

    // Validate here rather than trusting the SDK, so a schema mismatch is a typed error the caller
    // can retry on (PRD A.5 retries once on invalid JSON) instead of an unchecked cast.
    const parsed = req.schema.safeParse(object);
    if (!parsed.success) {
      throw new LlmValidationError(req.action, parsed.error.issues, JSON.stringify(object));
    }

    return {
      value: parsed.data,
      usage: toTokenUsage(usage),
      modelId: this.models[req.tier],
    };
  }
}

/**
 * Voyage embeddings (PRD §7.2: `voyage-3`, 1024-d).
 *
 * There is no first-party AI SDK provider for Voyage, so this calls the REST API directly. That is
 * still inside `packages/ai`, so product code is unaffected.
 */
export class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly dims: number;
  readonly modelId: string;
  private readonly apiKey: string;
  private readonly endpoint: string;

  constructor(options: {
    apiKey: string;
    model: string;
    dims: number;
    endpoint?: string;
  }) {
    this.apiKey = options.apiKey;
    this.modelId = options.model;
    this.dims = options.dims;
    this.endpoint = options.endpoint ?? 'https://api.voyageai.com/v1/embeddings';
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: texts, model: this.modelId }),
    });

    if (!response.ok) {
      throw new LlmProviderError(
        'EMBED',
        `Voyage embeddings failed: ${response.status} ${await response.text()}`,
      );
    }

    const body = (await response.json()) as { data?: Array<{ embedding: number[] }> };
    const vectors = (body.data ?? []).map((d) => d.embedding);

    for (const vector of vectors) {
      if (vector.length !== this.dims) {
        throw new LlmProviderError(
          'EMBED',
          'Voyage returned ' +
            vector.length +
            '-dimensional vectors but EMBED_DIMS is ' +
            this.dims +
            '. The database column is vector(' +
            this.dims +
            '); fix the config, do not truncate.',
        );
      }
    }

    return vectors;
  }
}
