/**
 * Mock LLM and embedding providers — PHASES.md task 0.5.
 *
 * "Mock provider: replays recorded fixtures or returns a fixed string with configurable latency
 * (used by all tests and by week 1)."
 *
 * The configurable latency matters: PRD §16 week 1 runs the editor spike against this provider with
 * 250 ms simulated latency and requires TTFB ≤ 600 ms, and §15 runs the k6 load test the same way.
 * Latency is applied before the first chunk, so it models time-to-first-byte, not total time.
 */

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

/** A canned response. `match` decides which request it answers; the first match wins. */
export type MockResponse = {
  readonly match?: (req: LlmRequest) => boolean;
  /** Streamed back in pieces, or returned whole by `complete`. */
  readonly text?: string;
  /** For `complete`: the object to return instead of parsing `text`. */
  readonly value?: unknown;
  /**
   * For `complete`: derives the object from the request. Lets a mock answer a structured call
   * whose shape depends on the input — extraction, for one, has to reflect the paper it was given.
   * Takes precedence over `value`.
   */
  readonly respond?: (req: LlmRequest) => unknown;
  /** Overrides the usage numbers reported on the finish chunk. */
  readonly usage?: Partial<TokenUsage>;
  /** Throws instead of answering, to exercise the error path (no cap charged, PRD §11.5). */
  readonly error?: string;
};

export type MockProviderOptions = {
  /** Milliseconds before the first chunk. PRD §16 week 1 uses 250. */
  readonly latencyMs?: number;
  /** Milliseconds between subsequent chunks. */
  readonly chunkDelayMs?: number;
  /** Characters per streamed chunk. */
  readonly chunkSize?: number;
  /** Recorded responses, tried in order. */
  readonly responses?: readonly MockResponse[];
  /** Used when nothing matches. */
  readonly defaultText?: string;
  readonly modelIds?: Partial<Record<Tier, string>>;
};

const sleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));

/** Rough stand-in for a tokenizer: ~4 characters per token. Only used to populate mock usage. */
const approxTokens = (text: string): number => Math.ceil(text.length / 4);

export class MockLlmProvider implements LlmProvider {
  /** Every request seen, in order. Tests assert against this. */
  readonly calls: LlmRequest[] = [];

  private readonly latencyMs: number;
  private readonly chunkDelayMs: number;
  private readonly chunkSize: number;
  private readonly responses: readonly MockResponse[];
  private readonly defaultText: string;
  private readonly modelIds: Record<Tier, string>;

  constructor(options: MockProviderOptions = {}) {
    this.latencyMs = options.latencyMs ?? 0;
    this.chunkDelayMs = options.chunkDelayMs ?? 0;
    this.chunkSize = options.chunkSize ?? 24;
    this.responses = options.responses ?? [];
    this.defaultText = options.defaultText ?? 'Mock suggestion text.';
    this.modelIds = {
      fast: options.modelIds?.fast ?? 'mock-fast',
      strong: options.modelIds?.strong ?? 'mock-strong',
    };
  }

  modelIdFor(tier: Tier): string {
    return this.modelIds[tier];
  }

  /** Number of calls seen for one action. */
  callsFor(action: string): LlmRequest[] {
    return this.calls.filter((c) => c.action === action);
  }

  reset(): void {
    this.calls.length = 0;
  }

  private resolve(req: LlmRequest): MockResponse {
    return this.responses.find((r) => !r.match || r.match(req)) ?? { text: this.defaultText };
  }

  private usageFor(req: LlmRequest, output: string, override?: Partial<TokenUsage>): TokenUsage {
    const volatile = req.system.volatile ?? '';
    const messages = req.messages.map((m) => m.content).join('\n');
    return {
      inputTokens: override?.inputTokens ?? approxTokens(volatile + messages),
      cachedInputTokens: override?.cachedInputTokens ?? approxTokens(req.system.cached),
      cacheWriteTokens: override?.cacheWriteTokens ?? 0,
      outputTokens: override?.outputTokens ?? approxTokens(output),
    };
  }

  async *stream(req: LlmRequest): AsyncIterable<LlmChunk> {
    this.calls.push(req);
    const response = this.resolve(req);

    await sleep(this.latencyMs);
    if (req.signal?.aborted) return;

    if (response.error) {
      throw new LlmProviderError(req.action, response.error);
    }

    const text = response.text ?? this.defaultText;
    for (let i = 0; i < text.length; i += this.chunkSize) {
      if (req.signal?.aborted) return;
      yield { type: 'text', text: text.slice(i, i + this.chunkSize) };
      if (this.chunkDelayMs > 0) await sleep(this.chunkDelayMs);
    }

    yield {
      type: 'finish',
      usage: this.usageFor(req, text, response.usage),
      modelId: this.modelIdFor(req.tier),
      finishReason: 'stop',
    };
  }

  async complete<T>(req: LlmRequest & { schema: z.ZodType<T> }): Promise<LlmResult<T>> {
    this.calls.push(req);
    const response = this.resolve(req);

    await sleep(this.latencyMs);

    if (response.error) {
      throw new LlmProviderError(req.action, response.error);
    }

    const raw = response.respond
      ? response.respond(req)
      : response.value !== undefined
        ? response.value
        : JSON.parse(response.text ?? '{}');
    const parsed = req.schema.safeParse(raw);
    if (!parsed.success) {
      throw new LlmValidationError(req.action, parsed.error.issues, JSON.stringify(raw));
    }

    return {
      value: parsed.data,
      usage: this.usageFor(req, JSON.stringify(raw), response.usage),
      modelId: this.modelIdFor(req.tier),
    };
  }
}

export type MockEmbeddingOptions = {
  readonly dims?: number;
  readonly latencyMs?: number;
  readonly modelId?: string;
};

/**
 * Deterministic embeddings: the same text always yields the same unit vector, and different texts
 * yield different ones. That is enough for retrieval round-trip tests without a provider.
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly dims: number;
  readonly modelId: string;
  readonly calls: string[][] = [];
  private readonly latencyMs: number;

  constructor(options: MockEmbeddingOptions = {}) {
    this.dims = options.dims ?? 1024;
    this.modelId = options.modelId ?? 'mock-embed';
    this.latencyMs = options.latencyMs ?? 0;
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    this.calls.push([...texts]);
    await sleep(this.latencyMs);
    return texts.map((text) => this.vectorFor(text));
  }

  private vectorFor(text: string): number[] {
    // xorshift32 seeded from the text, so the vector is stable across runs and processes.
    let seed = 2166136261;
    for (let i = 0; i < text.length; i++) {
      seed ^= text.charCodeAt(i);
      seed = Math.imul(seed, 16777619);
    }

    const vector = new Array<number>(this.dims);
    let state = seed || 1;
    let sumOfSquares = 0;
    for (let i = 0; i < this.dims; i++) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      const value = (state >>> 0) / 0xffffffff - 0.5;
      vector[i] = value;
      sumOfSquares += value * value;
    }

    const norm = Math.sqrt(sumOfSquares) || 1;
    for (let i = 0; i < this.dims; i++) {
      vector[i] = (vector[i] ?? 0) / norm;
    }
    return vector;
  }
}
