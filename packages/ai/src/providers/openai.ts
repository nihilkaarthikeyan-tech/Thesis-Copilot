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
 * Two real differences from the Anthropic adapter:
 *
 * **Caching.** Anthropic caches what you mark with `cache_control`; OpenAI caches automatically on
 * prefixes over ~1,024 tokens with no marker at all. So the system blocks here carry no cache
 * annotation, and the same §10.3 layout — stable content first, volatile after — is what earns the
 * discount, by keeping the prefix identical between calls.
 *
 * **Reasoning.** The `gpt-5` family reasons before answering, and reasoning tokens are billed as
 * output and drawn from the same `maxOutputTokens` budget. Measured on 2026-09-13: at the fast
 * tier's 120-token cap `gpt-5-nano` spent all 64 on reasoning and returned an empty string; raising
 * the cap to 500 spent 448 the same way. That is not a degraded answer, it is paying full price for
 * nothing. `reasoningEffort: 'minimal'` turns it off and the same request returned 75 tokens of
 * prose. See `providerOptionsFor` below for why that is tied to the tier.
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

/**
 * Whether a model reasons before answering, and so spends `maxOutputTokens` doing it.
 *
 * `gpt-5*` and the o-series do; `gpt-4o-*` and `gpt-4.1-*` do not. Matched on the id because that
 * is all the adapter is given, and a wrong guess costs a warning line rather than a failure.
 */
function reasons(modelId: string): boolean {
  const id = modelId.trim().toLowerCase();
  return id.startsWith('gpt-5') || /^o[134]/.test(id);
}

/**
 * Room to think, on top of the action's own answer budget, for a model that reasons.
 *
 * `maxTokens` in every builder bounds the *answer*: Assist's 120 tokens is "a sentence or two, not
 * a paragraph", Command's 900 is "a rewritten selection". Those are product decisions about what
 * the student sees. Reasoning tokens are not seen by anybody — but OpenAI draws them from the same
 * `max_output_tokens`, so on a reasoning model the two budgets silently became one and the answer
 * got whatever the thinking left over. Usually nothing: `pnpm ai:shakedown` on 2026-09-14 had the
 * style profile spend all 600 tokens reasoning and return no object, five times out of five.
 *
 * So the adapter asks for `maxTokens + REASONING_HEADROOM` and lets the two budgets be two again.
 * The answer is still bounded by the prompt and by what the action asks for; this only stops the
 * thinking from eating it.
 *
 * 1,000 is measured, not chosen: across the nineteen shakedown cases the largest reasoning spend
 * at `'low'` effort was ~460 tokens (search queries), and doubling the worst case observed is the
 * usual margin for a number that fails silently when it is too small.
 *
 * **This costs money.** Reasoning bills as output. `ACTION_PROFILES` in `packages/config` still
 * prices the strong tier by answer length alone, so the ₹100 projection understates strong-tier
 * calls by whatever the model actually thinks — see `docs/COSTING.md` and the note in
 * `ADR-0011`. The runtime meter is unaffected: it bills `usage.outputTokens`, which already
 * includes reasoning.
 */
export const REASONING_HEADROOM = 1_000;

/**
 * Schemas OpenAI's strict Structured Outputs mode has already refused, so the next call with the
 * same schema goes straight to JSON mode instead of paying the round trip again.
 *
 * Process-local and deliberately not shared or persisted: it is a cache of a fact about a schema
 * object, and it costs one rejected request to rebuild. A `WeakSet` so a schema that goes out of
 * scope is collectable.
 */
const lenientSchemas = new WeakSet<object>();

/**
 * Whether OpenAI refused the *schema* rather than failing the generation.
 *
 * The distinction is the whole basis of the fallback in `complete`: a schema refusal arrives
 * before any tokens are generated, costs nothing, and means "ask again differently". Anything else
 * — a rate limit, a timeout, a model that would not answer — must surface, because retrying it
 * would spend money on the same failure twice.
 *
 * Matched on the message because that is what the API gives: an `AI_APICallError` whose body is
 * `Invalid schema for response_format 'response': …`. Checked down the cause chain since the SDK
 * wraps it.
 */
function isSchemaRejection(cause: unknown): boolean {
  for (let e: unknown = cause, depth = 0; e && depth < 5; depth++) {
    const message = (e as { message?: unknown }).message;
    if (typeof message === 'string' && message.includes('Invalid schema for response_format')) {
      return true;
    }
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

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

  /**
   * Provider options for one call.
   *
   * Three things, all of them learned from `pnpm ai:shakedown` on 2026-09-14, which was the first
   * time any structured call in this product met a real OpenAI model. Sixteen of nineteen failed.
   *
   * **`strictJsonSchema: false` on structured calls.** The SDK defaults it to `true`, which sends
   * the schema to OpenAI's strict Structured Outputs mode. Strict mode has two rules our schemas
   * break: every key in `properties` must also appear in `required`, and tuples are not expressible.
   * Almost every schema in `packages/ai` uses `.default([])` for "the model may leave this out,
   * which means none" — `flags`, `results`, `candidates`, `findings`, `references` — and
   * `claimsSchema.span` is a `z.tuple([number, number])`. Strict mode rejected all of them before
   * the request was even sent, with `Invalid schema for response_format`.
   *
   * Relaxing it does not weaken the guarantee, because the guarantee never came from OpenAI:
   * `complete()` runs `req.schema.safeParse` on whatever comes back and raises
   * `LlmValidationError` if it does not fit. Strict mode was a second, stricter lock on a door
   * that is already locked — and it was jamming.
   *
   * **Reasoning off on the fast tier** (unchanged, see the header): a 120-token cap leaves no room
   * to think, and leaving it on returns an empty string at full price.
   *
   * **Reasoning effort by tier.** `'minimal'` on the fast tier, because a 120-token answer wants
   * no deliberation and paying for it returns an empty string. `'low'` on the strong tier, where
   * drafting and coherence analysis genuinely improve for it — turning it off entirely was tried
   * on 2026-09-14 and cost two actions their accuracy: Command and the citation-role rewrite both
   * started returning objects the schema rejected. The budget for that thinking is
   * `REASONING_HEADROOM`, added to the action's cap rather than taken out of it.
   */
  private providerOptionsFor(tier: Tier, strict: boolean) {
    if (!reasons(this.models[tier])) {
      // gpt-4o-* and gpt-4.1-* take neither key, and log "not supported" for each one they are
      // sent. A warning on every call is how real warnings stop being read.
      return strict ? undefined : { openai: { strictJsonSchema: false } };
    }
    const openai: { reasoningEffort: string; strictJsonSchema?: boolean } = {
      reasoningEffort: tier === 'fast' ? 'minimal' : 'low',
    };
    if (!strict) openai.strictJsonSchema = false;
    return { openai };
  }

  /**
   * The `max_output_tokens` to ask for: the action's answer budget, plus room to think when the
   * model is one that thinks. See `REASONING_HEADROOM`.
   */
  private outputBudget(req: LlmRequest): number {
    return reasons(this.models[req.tier]) ? req.maxTokens + REASONING_HEADROOM : req.maxTokens;
  }

  /**
   * `temperature`, unless the model would only warn about it.
   *
   * The `gpt-5` family and the o-series reject it — "temperature is not supported for reasoning
   * models" — and the SDK logs that for every single call carrying one. Every builder in
   * `packages/ai` sets a temperature, deliberately and per action, so before this that was a
   * warning on every request in the product.
   *
   * Worth saying plainly, because it is a behaviour change nobody chose: on a reasoning model
   * those per-action temperatures do nothing. `queries` asks for 0.7 to get varied search terms
   * and `extraction` asks for 0 to get none; both now run at the model's own default. If that
   * turns out to matter, the lever is the prompt, not this parameter.
   */
  private temperatureFor(req: LlmRequest): number | undefined {
    if (req.temperature === undefined || reasons(this.models[req.tier])) return undefined;
    return req.temperature;
  }

  async *stream(req: LlmRequest): AsyncIterable<LlmChunk> {
    let usage: TokenUsage;
    let finishReason: string;

    try {
      const providerOptions = this.providerOptionsFor(req.tier, true);
      const temperature = this.temperatureFor(req);
      const result = streamText({
        model: this.model(req.tier),
        instructions: this.instructions(req),
        messages: this.messages(req),
        maxOutputTokens: this.outputBudget(req),
        ...(providerOptions ? { providerOptions } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
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

  /**
   * One `generateObject` attempt at a chosen strictness.
   *
   * Split out so `complete` can make the same call twice without the two copies drifting.
   */
  private async generateOnce<T>(
    req: LlmRequest & { schema: z.ZodType<T> },
    strict: boolean,
  ): Promise<{ object: unknown; usage: LanguageModelUsage }> {
    const providerOptions = this.providerOptionsFor(req.tier, strict);
    const temperature = this.temperatureFor(req);
    const result = await generateObject({
      model: this.model(req.tier),
      schema: req.schema,
      instructions: this.instructions(req),
      messages: this.messages(req),
      maxOutputTokens: this.outputBudget(req),
      ...(providerOptions ? { providerOptions } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(req.signal ? { abortSignal: req.signal } : {}),
      // Same boundary as the Anthropic adapter: `generateObject`'s return type is conditional on
      // the schema's inferred output, which TS cannot resolve through a generic `z.ZodType<T>`.
      // The result is validated below, so nothing downstream trusts the cast.
    } as unknown as Parameters<typeof generateObject>[0]);

    return { object: result.object, usage: result.usage };
  }

  /**
   * A structured call: strict Structured Outputs where the schema allows it, JSON mode where it
   * does not.
   *
   * Both settings are wrong on their own, which is why this tries one and falls back to the other.
   *
   * **Strict is better when it works.** OpenAI validates the schema server-side and the model
   * cannot return anything else. That matters most where the prompt and the schema disagree:
   * `cite_role.md` and `command.md` both end with "output only the rewritten sentence", while the
   * code asks for `{ text: string }`. In JSON mode the model follows the prose instruction and
   * returns a bare sentence — measured 2026-09-14, the citation-role rewrite failed 5 times in 6,
   * each attempt burning ~25 s of SDK retries first. Under strict mode it passed 3 for 3.
   *
   * **Strict cannot take most of our schemas.** It requires every key in `properties` to appear in
   * `required`, and cannot express a tuple. `.default([])` is how nearly every schema here says
   * "the model may leave this out, which means none", so strict rejects thirteen of nineteen.
   *
   * The fallback is cheap and exact, which is what makes this worth doing rather than guessing:
   * OpenAI rejects an unsupported schema *before generating anything*, in about 400 ms, for no
   * tokens and no money. So the first call with a given schema pays one round trip to find out,
   * and `lenientSchemas` remembers the answer for the life of the process. A `WeakSet` keyed on
   * the schema object holds nothing alive.
   *
   * Anything other than a schema rejection is a real failure and is raised, not retried.
   */
  async complete<T>(req: LlmRequest & { schema: z.ZodType<T> }): Promise<LlmResult<T>> {
    let object: unknown;
    let usage: LanguageModelUsage;

    try {
      const knownLenient = lenientSchemas.has(req.schema);
      try {
        ({ object, usage } = await this.generateOnce(req, !knownLenient));
      } catch (cause) {
        if (knownLenient || !isSchemaRejection(cause)) throw cause;
        lenientSchemas.add(req.schema);
        ({ object, usage } = await this.generateOnce(req, false));
      }
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
