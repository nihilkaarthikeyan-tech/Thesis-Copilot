/**
 * Provider abstraction — PRD §10.2.
 *
 * PRD §0.2: "No vendor lock-in in product code: all LLM/embedding calls go through `packages/ai`
 * provider abstraction. Product code never imports a vendor SDK directly."
 *
 * The `LlmProvider`, `EmbeddingProvider` and `LlmRequest` shapes below are copied from §10.2.
 * `LlmChunk` and `LlmResult` are referenced there but not defined; they are specified here and
 * flagged in docs/BUILD_LOG.md.
 */

import type { AiAction, Tier, TokenUsage } from '@tc/config';
import type { z } from 'zod';

export type { AiAction, Tier, TokenUsage };

/** A conversation turn. The system prompt travels in `LlmRequest.system`, not here. */
export type Message = {
  readonly role: 'user' | 'assistant';
  readonly content: string;
  /**
   * Pictures sent with a user turn (ADR-0064: an equation from a photo). Only a request that
   * needs one carries one; every adapter sends them after the text, as image parts.
   */
  readonly images?: ReadonlyArray<{ readonly data: Uint8Array; readonly mediaType: string }>;
};

/** The AI SDK's content for one turn: plain text, or text then images when a turn has any. */
export function sdkContent(m: Message): unknown {
  if (!m.images?.length || m.role !== 'user') return m.content;
  return [
    { type: 'text', text: m.content },
    ...m.images.map((img) => ({ type: 'image', image: img.data, mediaType: img.mediaType })),
  ];
}

/**
 * PRD §10.2, verbatim shape.
 *
 * `system.cached` is the byte-stable block (persona, rules, scope, outline, glossary, style) that
 * carries `cache_control` (§10.3). `system.volatile` is everything that changes per call and must
 * never enter the cache key: chapter title, pinned sources, retrieved chunks, surrounding text.
 */
export type LlmRequest = {
  readonly tier: Tier;
  readonly system: { readonly cached: string; readonly volatile?: string };
  readonly messages: readonly Message[];
  readonly maxTokens: number;
  readonly temperature?: number;
  /** For logging and caps (§10.2 steps 1, 5, 6). */
  readonly action: AiAction;
  readonly userId: string;
  readonly documentId?: string;
  /** Lets the caller cancel an in-flight stream, e.g. when the student keeps typing (Appendix B.3). */
  readonly signal?: AbortSignal;
};

/**
 * One event in a streamed response.
 *
 * `text` arrives repeatedly as the model writes. `finish` arrives exactly once at the end and is the
 * only chunk carrying `usage`, which is what `AiCallLog` records (§11.5: cost comes from actual
 * token usage, never an estimate).
 */
export type LlmChunk =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'finish';
      readonly usage: TokenUsage;
      readonly modelId: string;
      readonly finishReason: string;
    };

/** Result of a structured (non-streamed) call. */
export type LlmResult<T> = {
  readonly value: T;
  readonly usage: TokenUsage;
  readonly modelId: string;
  /**
   * ADR-0048: the answer was cut off and only the values the model finished were kept. Set only
   * when it happened, so a caller that cares (a list that must be complete) can tell.
   */
  readonly truncatedRepaired?: true;
};

/** PRD §10.2. */
export interface LlmProvider {
  /** Streaming, for assist / chat / draft. */
  stream(req: LlmRequest): AsyncIterable<LlmChunk>;
  /** Structured output validated against a Zod schema. */
  complete<T>(req: LlmRequest & { schema: z.ZodType<T> }): Promise<LlmResult<T>>;
  /** Resolves the configured model id for a tier. Used by `pnpm ai:verify` (Appendix E.1). */
  modelIdFor(tier: Tier): string;
}

/** PRD §10.2. */
export interface EmbeddingProvider {
  embed(texts: readonly string[]): Promise<number[][]>;
  /**
   * The same, with the tokens the provider reports having billed (2026-09-25). §11.5 prices from
   * actual usage, never an estimate, and until this existed embedding was the one AI spend the
   * per-user ceiling and the §14 alerts could not see.
   */
  embedWithUsage(texts: readonly string[]): Promise<{ vectors: number[][]; tokens: number }>;
  readonly dims: number;
  readonly modelId: string;
}

/** Raised when a provider returns something that does not satisfy the requested schema. */
export class LlmValidationError extends Error {
  constructor(
    readonly action: AiAction,
    readonly issues: unknown,
    readonly raw: string,
  ) {
    super(`The model returned output that does not match the schema for action ${action}`);
    this.name = 'LlmValidationError';
  }
}

/** Raised when the provider itself fails. No cap is charged for these (PRD §11.5). */
export class LlmProviderError extends Error {
  constructor(
    readonly action: AiAction,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'LlmProviderError';
  }
}
