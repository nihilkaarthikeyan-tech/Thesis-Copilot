/**
 * OpenAI adapter — ADR-0011.
 *
 * The second of the two files allowed to import a vendor SDK (PRD §0.2). It exists for one reason,
 * recorded in the ADR: `gpt-5-nano` costs ₹0.0097 per autocomplete against Haiku 4.5's ₹0.1803, and
 * no arrangement of Anthropic models makes the owner's 8,000-autocomplete tier affordable.
 *
 * Deliberately close to a transcription of `anthropic.ts`. Both go through the same Vercel AI SDK
 * primitives, so keeping the two files structurally identical means a fix to one is obviously
 * needed in the other — which is worth more here than any cleverness saved by sharing code, given
 * that the last defect in the Anthropic adapter was a request shape the SDK rejected outright.
 *
 * The one real difference is caching. Anthropic caches what you mark with `cache_control`; OpenAI
 * caches automatically on prefixes over ~1,024 tokens with no marker at all. So the system blocks
 * here carry no cache annotation, and the same §10.3 layout — stable content first, volatile after
 * — is what earns the discount, by keeping the prefix identical between calls.
 */

import { createOpenAI } from '@ai-sdk/openai';
import {
  generateObject,
  type LanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
  type SystemModelMessage,
  streamText,
} from 'ai';
import type { z } from 'zod';
import {
  type LlmChunk,
  type LlmProvider,
  LlmProviderError,
  type LlmRequest,
  type LlmResult,
  LlmValidationError,
  type Tier,
  type TokenUsage,
} from '../types.js';
import { toTokenUsage } from './anthropic.js';

export type OpenAiProviderOptions = {
  readonly apiKey: string;
  readonly fastModel: string;
  readonly strongModel: string;
  readonly baseURL?: string;
  /** Injected in tests to read the request body without a network. */
  readonly fetch?: typeof globalThis.fetch;
};

export class OpenAiLlmProvider implements LlmProvider {
  private readonly openai: ReturnType<typeof createOpenAI>;
  private readonly models: Record<Tier, string>;

  constructor(options: OpenAiProviderOptions) {
    this.openai = createOpenAI({
      apiKey: options.apiKey,
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
    this.models = { fast: options.fastModel, strong: options.strongModel };
  }

  modelIdFor(tier: Tier): string {
    return this.models[tier];
  }

  private model(tier: Tier): LanguageModel {
    return this.openai(this.models[tier]);
  }

  /**
   * The same two system blocks as the Anthropic adapter, and in the same order, but with no cache
   * marker: OpenAI caches long prefixes on its own. The split still matters — it is what keeps the
   * stable half byte-identical across calls, which is the only thing that earns the discount.
   */
  private instructions(req: LlmRequest): SystemModelMessage[] {
    const parts: SystemModelMessage[] = [{ role: 'system', content: req.system.cached }];
    if (req.system.volatile) parts.push({ role: 'system', content: req.system.volatile });
    return parts;
  }

  private messages(req: LlmRequest): ModelMessage[] {
    return req.messages.map((m) => ({ role: m.role, content: m.content }) as ModelMessage);
  }

  async *stream(req: LlmRequest): AsyncIterable<LlmChunk> {
    let usage: TokenUsage;
    let finishReason: string;

    try {
      const result = streamText({
        model: this.model(req.tier),
        instructions: this.instructions(req),
        messages: this.messages(req),
        maxOutputTokens: req.maxTokens,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.signal ? { abortSignal: req.signal } : {}),
      });

      for await (const delta of result.textStream) {
        yield { type: 'text', text: delta };
      }

      // Inside the try, for the reason the Anthropic adapter documents: a refused request ends
      // `textStream` without throwing and surfaces the failure on these promises instead.
      usage = toTokenUsage(await result.usage);
      finishReason = await result.finishReason;
    } catch (cause) {
      throw new LlmProviderError(req.action, 'OpenAI stream failed', cause);
    }

    yield { type: 'finish', usage, modelId: this.models[req.tier], finishReason };
  }

  async complete<T>(req: LlmRequest & { schema: z.ZodType<T> }): Promise<LlmResult<T>> {
    let object: unknown;
    let usage: LanguageModelUsage;

    try {
      const result = await generateObject({
        model: this.model(req.tier),
        schema: req.schema,
        instructions: this.instructions(req),
        messages: this.messages(req),
        maxOutputTokens: req.maxTokens,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.signal ? { abortSignal: req.signal } : {}),
        // Same boundary as the Anthropic adapter: `generateObject`'s return type is conditional on
        // the schema's inferred output, which TS cannot resolve through a generic `z.ZodType<T>`.
        // The result is validated below, so nothing downstream trusts the cast.
      } as unknown as Parameters<typeof generateObject>[0]);

      object = result.object;
      usage = result.usage;
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'AI_NoObjectGeneratedError') {
        throw new LlmValidationError(req.action, cause, cause.message);
      }
      throw new LlmProviderError(req.action, 'OpenAI structured call failed', cause);
    }

    const parsed = req.schema.safeParse(object);
    if (!parsed.success) {
      throw new LlmValidationError(req.action, parsed.error.issues, JSON.stringify(object));
    }

    return { value: parsed.data, usage: toTokenUsage(usage), modelId: this.models[req.tier] };
  }
}
