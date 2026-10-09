/**
 * The OpenAI adapter — ADR-0011, and the second of the two files allowed to import a vendor SDK.
 *
 * These exist for the same reason `anthropic.spec.ts` does, and they are the same lesson learned
 * twice. On 2026-09-14 `pnpm ai:shakedown` ran every structured-output path in the product against
 * a real OpenAI model for the first time. Sixteen of nineteen failed. Every one had been "working"
 * for the whole build, against a mock that returns well-formed objects by construction.
 *
 * The three faults are each pinned below, and all three are invisible to a test that inspects the
 * adapter's arguments rather than its request body:
 *
 * 1. `generateObject` defaults to OpenAI's strict Structured Outputs mode, which refuses any
 *    schema with a non-required key or a tuple. Nearly every schema in `packages/ai` has both.
 * 2. `max_output_tokens` is shared between the answer and the model's reasoning, so an action's
 *    answer budget was being spent on thinking and returning nothing.
 * 3. `temperature` is rejected by reasoning models, and every builder in the product sets one.
 *
 * As in the Anthropic spec, the fetch is captured and then refused: a valid response would have to
 * be fabricated, and §0.3 rule 1 forbids inventing a wire format. What is under test is what we
 * send.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  noThinking,
  OpenAiLlmProvider,
  REASONING_HEADROOM,
  REASONING_HEADROOM_BY_EFFORT,
} from '../src/providers/openai.js';
import { LlmProviderError, type LlmRequest } from '../src/types.js';

/** The OpenAI responses-API body, in the parts these tests read. */
type WireBody = {
  model: string;
  max_output_tokens: number;
  temperature?: number;
  reasoning?: { effort?: string };
  store?: boolean;
  text?: { format?: { type: string; strict?: boolean; schema?: unknown } };
  instructions?: unknown;
  input?: Array<{ role: string; content: unknown }>;
};

type Capture = { bodies: WireBody[] };

/**
 * Runs the adapter against a fetch that records every request and answers each with `respond`.
 *
 * Every body is kept, not just the first, because the fallback in `complete` is a second request
 * and the whole point of it is what changes between the two.
 */
async function capture(
  request: LlmRequest,
  how: 'stream' | 'complete',
  options: {
    readonly fastModel?: string;
    readonly strongModel?: string;
    readonly schema?: z.ZodType<unknown>;
    readonly respond?: (n: number) => Response;
  } = {},
): Promise<Capture> {
  const bodies: WireBody[] = [];
  const provider = new OpenAiLlmProvider({
    apiKey: 'test-key',
    fastModel: options.fastModel ?? 'gpt-5-nano',
    strongModel: options.strongModel ?? 'gpt-5-mini',
    fetch: (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as WireBody);
      // 400 rather than 500 so the SDK does not retry and inflate the count.
      return options.respond?.(bodies.length) ?? new Response('{"error":{}}', { status: 400 });
    }) as typeof globalThis.fetch,
  });

  await expect(async () => {
    if (how === 'complete') {
      await provider.complete({
        ...request,
        schema: options.schema ?? z.object({ text: z.string() }),
      });
      return;
    }
    for await (const _chunk of provider.stream(request)) {
      // drained; the call fails before any chunk arrives
    }
  }).rejects.toThrow(Error);

  if (bodies.length === 0) throw new Error('no request was sent');
  return { bodies };
}

const request = (over: Partial<LlmRequest> = {}): LlmRequest => ({
  tier: 'fast',
  system: { cached: 'CACHED PREFIX', volatile: 'VOLATILE HALF' },
  messages: [{ role: 'user', content: 'hello' }],
  maxTokens: 120,
  action: 'ASSIST',
  userId: 'u1',
  ...over,
});

/** The body OpenAI sends back when it will not accept the schema at all. */
const schemaRejection = () =>
  new Response(
    JSON.stringify({
      error: {
        message:
          "Invalid schema for response_format 'response': In context=(), 'required' is required to be supplied and to be an array including every key in properties. Missing 'flags'.",
        type: 'invalid_request_error',
      },
    }),
    { status: 400, headers: { 'content-type': 'application/json' } },
  );

describe('room to think', () => {
  it('adds the reasoning headroom on top of the action’s answer budget', async () => {
    // The defect: `maxTokens` bounds the answer — Assist's 120 tokens is "a sentence or two". A
    // reasoning model draws its thinking from the same allowance, so the style profile spent all
    // 600 of its tokens reasoning and returned no object, five runs out of five.
    const { bodies } = await capture(request({ maxTokens: 600 }), 'stream');

    expect(bodies[0]?.max_output_tokens).toBe(600 + REASONING_HEADROOM);
  });

  it('leaves the budget alone for a model that does not reason', async () => {
    const { bodies } = await capture(request({ maxTokens: 600 }), 'stream', {
      fastModel: 'gpt-4o-mini',
    });

    expect(bodies[0]?.max_output_tokens).toBe(600);
  });

  it('asks for minimal effort on the fast tier and low on the strong one', async () => {
    // Fast is a 120-token continuation: there is no room to deliberate and no task that wants it.
    // Strong is drafting and analysis, where turning reasoning off entirely was tried on
    // 2026-09-14 and cost Command and the citation-role rewrite their accuracy.
    const fast = await capture(request({ tier: 'fast' }), 'stream');
    const strong = await capture(request({ tier: 'strong' }), 'stream');

    expect(fast.bodies[0]?.reasoning?.effort).toBe('minimal');
    expect(strong.bodies[0]?.reasoning?.effort).toBe('low');
  });

  it('turns thinking off with "none" on a gpt-5.x model, which refuses "minimal"', async () => {
    const fast = await capture(request({ tier: 'fast' }), 'stream', { fastModel: 'gpt-5.4-nano' });
    expect(fast.bodies[0]?.reasoning?.effort).toBe('none');
    expect(noThinking('gpt-5-nano')).toBe('minimal');
    expect(noThinking('gpt-5.1-mini')).toBe('none');
  });

  it('sends no reasoning field to a model that has none', async () => {
    // gpt-4o-mini logs "reasoningEffort is not supported" for every request carrying it, and a
    // warning on every call is how real warnings stop being read.
    const { bodies } = await capture(request(), 'stream', { fastModel: 'gpt-4o-mini' });

    expect(bodies[0]?.reasoning).toBeUndefined();
  });

  it('sends a request’s own effort, with headroom to match, on the wire (ADR-0111 addendum)', async () => {
    const { bodies } = await capture(
      request({ tier: 'strong', maxTokens: 700, reasoningEffort: 'high' }),
      'complete',
    );

    expect(bodies[0]?.reasoning?.effort).toBe('high');
    expect(bodies[0]?.max_output_tokens).toBe(700 + REASONING_HEADROOM_BY_EFFORT.high);
  });

  it('does not send a request’s own effort to a model that does not reason', async () => {
    const { bodies } = await capture(
      request({ tier: 'strong', maxTokens: 700, reasoningEffort: 'high' }),
      'stream',
      { strongModel: 'gpt-4.1-mini' },
    );

    expect(bodies[0]?.reasoning).toBeUndefined();
    expect(bodies[0]?.max_output_tokens).toBe(700);
  });
});

describe('retention', () => {
  it('tells OpenAI not to store the exchange, on every call', async () => {
    // PRD §12.2. The Responses API defaults `store` to true and keeps request and response bodies
    // for 30 days, so before this every chapter a student wrote was retained for a month while
    // /privacy said otherwise. Not a tuning choice, so it is asserted on every shape of call.
    const streamed = await capture(request(), 'stream');
    const structured = await capture(request({ tier: 'strong' }), 'complete');
    const plain = await capture(request(), 'stream', { fastModel: 'gpt-4o-mini' });

    expect(streamed.bodies[0]?.store).toBe(false);
    expect(structured.bodies[0]?.store).toBe(false);
    expect(plain.bodies[0]?.store).toBe(false);
  });

  it('is still set on the lenient retry, which is a second request', async () => {
    const lenient = z.object({ flags: z.array(z.string()).default([]) });
    const { bodies } = await capture(request({ tier: 'strong' }), 'complete', {
      schema: lenient,
      respond: (n) => (n === 1 ? schemaRejection() : new Response('{"error":{}}', { status: 400 })),
    });

    expect(bodies.map((b) => b.store)).toEqual([false, false]);
  });
});

describe('temperature', () => {
  it('is withheld from a reasoning model, which would only warn about it', async () => {
    const { bodies } = await capture(request({ temperature: 0.7 }), 'stream');

    expect(bodies[0]?.temperature).toBeUndefined();
  });

  it('is sent to a model that honours it', async () => {
    const { bodies } = await capture(request({ temperature: 0.7 }), 'stream', {
      fastModel: 'gpt-4o-mini',
    });

    expect(bodies[0]?.temperature).toBe(0.7);
  });
});

describe('structured calls', () => {
  it('asks for strict structured outputs first', async () => {
    // Strict is worth having where it works: it is what stops the model obeying a prompt that
    // ends "output only the rewritten sentence" when the code wants `{ text }`.
    const { bodies } = await capture(request({ tier: 'strong' }), 'complete');

    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.text?.format?.strict).toBe(true);
  });

  it('falls back to a lenient schema when OpenAI refuses the strict one', async () => {
    // The refusal arrives before any tokens are generated, so the retry costs nothing but a round
    // trip — which is what makes trying strict first affordable.
    const lenient = z.object({ flags: z.array(z.string()).default([]) });
    const { bodies } = await capture(request({ tier: 'strong' }), 'complete', {
      schema: lenient,
      respond: (n) => (n === 1 ? schemaRejection() : new Response('{"error":{}}', { status: 400 })),
    });

    expect(bodies).toHaveLength(2);
    expect(bodies[0]?.text?.format?.strict).toBe(true);
    expect(bodies[1]?.text?.format?.strict).toBe(false);
  });

  it('remembers the refusal, so the next call with that schema skips the strict attempt', async () => {
    const lenient = z.object({ flags: z.array(z.string()).default([]) });
    const respond = (n: number) =>
      n === 1 ? schemaRejection() : new Response('{"error":{}}', { status: 400 });

    await capture(request({ tier: 'strong' }), 'complete', { schema: lenient, respond });
    const second = await capture(request({ tier: 'strong' }), 'complete', { schema: lenient });

    expect(second.bodies).toHaveLength(1);
    expect(second.bodies[0]?.text?.format?.strict).toBe(false);
  });

  it('does not retry a failure that is not a schema refusal', async () => {
    // Retrying a rate limit or a refusal to answer spends money on the same failure twice.
    const { bodies } = await capture(request({ tier: 'strong' }), 'complete', {
      respond: () =>
        new Response(JSON.stringify({ error: { message: 'Rate limit reached' } }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
    });

    expect(bodies).toHaveLength(1);
  });
});

describe('the system blocks', () => {
  it('reach the model, cached half first, ahead of the user turn', async () => {
    // The adapter passes them as `instructions`, which is what the AI SDK requires — passing them
    // inside `messages` is what broke the Anthropic adapter for the whole build. Where they land
    // on the wire is the SDK's business and differs by vendor: Anthropic gets a `system` array,
    // while OpenAI's Responses API takes system-role items in `input` and accepts them there.
    // So what is asserted is the thing that matters either way — both blocks arrive, in §10.3's
    // order, before anything the student wrote. OpenAI's own spelling for an instruction turn is
    // `developer`, which is the SDK's translation and not ours to choose.
    const { bodies } = await capture(request(), 'stream');
    const input = bodies[0]?.input ?? [];

    expect(input.map((m) => m.role)).toEqual(['developer', 'developer', 'user']);
    expect(JSON.stringify(input[0])).toContain('CACHED PREFIX');
    expect(JSON.stringify(input[1])).toContain('VOLATILE HALF');
  });

  it('carries no cache marker — OpenAI caches long prefixes on its own', async () => {
    const { bodies } = await capture(request(), 'stream');

    expect(JSON.stringify(bodies[0])).not.toContain('cache_control');
  });
});

describe('provider errors', () => {
  it('are wrapped, so nothing downstream sees a vendor error type', async () => {
    const provider = new OpenAiLlmProvider({
      apiKey: 'test-key',
      fastModel: 'gpt-5-nano',
      strongModel: 'gpt-5-mini',
      fetch: (async () => new Response('{"error":{}}', { status: 400 })) as typeof globalThis.fetch,
    });

    await expect(async () => {
      for await (const _chunk of provider.stream(request())) {
        // drained
      }
    }).rejects.toThrow(LlmProviderError);
  });

  it('say what OpenAI said when the refusal arrives inside the stream (ADR-0145 addendum)', async () => {
    // Seen on 2026-10-09: an HTTP 200 stream whose event is a quota refusal. The SDK ends the
    // text stream quietly and reports only "No output generated", which is what the call log
    // recorded for every one of them. The event below is the one OpenAI sent, verbatim.
    const refusal = {
      type: 'error',
      sequence_number: 2,
      error: {
        type: 'insufficient_quota',
        code: 'credit_balance_exhausted',
        message:
          'You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.',
        param: null,
      },
    };
    const provider = new OpenAiLlmProvider({
      apiKey: 'test-key',
      fastModel: 'gpt-5-nano',
      strongModel: 'gpt-5-mini',
      fetch: (async () =>
        new Response(`event: error\ndata: ${JSON.stringify(refusal)}\n\n`, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        })) as typeof globalThis.fetch,
    });

    await expect(async () => {
      for await (const _chunk of provider.stream(request())) {
        // drained
      }
    }).rejects.toThrow(/OpenAI stream failed: .*no credits remaining/);
  });
});

describe('an answer cut off by the output budget (ADR-0048)', () => {
  /** A Responses API body whose JSON stops mid-way, as OpenAI returns it at max_output_tokens. */
  const truncated = (text: string) =>
    new Response(
      JSON.stringify({
        id: 'resp_1',
        created_at: 1,
        model: 'gpt-5-mini',
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        output: [
          {
            type: 'message',
            role: 'assistant',
            id: 'msg_1',
            status: 'incomplete',
            content: [{ type: 'output_text', text, annotations: [] }],
          },
        ],
        usage: {
          input_tokens: 100,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens: 40,
          output_tokens_details: { reasoning_tokens: 0 },
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );

  const provider = (respond: () => Response) =>
    new OpenAiLlmProvider({
      apiKey: 'test-key',
      fastModel: 'gpt-5-nano',
      strongModel: 'gpt-5-mini',
      fetch: (async () => respond()) as typeof globalThis.fetch,
    });

  it('keeps the items the model finished and says the answer was repaired', async () => {
    const schema = z.object({ themes: z.array(z.object({ name: z.string() })) });
    const result = await provider(() =>
      truncated('{"themes":[{"name":"Solar dryers"},{"name":"Cost"},{"name":"Fish qual'),
    ).complete({ ...request({ tier: 'strong' }), schema });

    expect(result.value).toEqual({ themes: [{ name: 'Solar dryers' }, { name: 'Cost' }] });
    expect(result.truncatedRepaired).toBe(true);
  });

  it('still fails, with the model’s own text, when nothing complete can be kept', async () => {
    const schema = z.object({ text: z.string() });
    await expect(
      provider(() => truncated('{"text":"The results show that')).complete({
        ...request({ tier: 'strong' }),
        schema,
      }),
    ).rejects.toMatchObject({ raw: expect.stringContaining('The results show that') });
  });
});

describe('a picture with the question (ADR-0064)', () => {
  it('sends the image after the text, as an input_image data URL on the user turn', async () => {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const { bodies } = await capture(
      request({
        tier: 'strong',
        action: 'COMMAND',
        messages: [
          { role: 'user', content: 'read this', images: [{ data: png, mediaType: 'image/png' }] },
        ],
      }),
      'complete',
    );
    const input = (bodies[0] as unknown as { input: Array<{ role: string; content: unknown }> })
      .input;
    const user = input.find((m) => m.role === 'user');
    const parts = user?.content as Array<{ type: string; text?: string; image_url?: string }>;
    expect(parts[0]).toMatchObject({ type: 'input_text', text: 'read this' });
    expect(parts[1]?.type).toBe('input_image');
    expect(parts[1]?.image_url).toBe(
      `data:image/png;base64,${Buffer.from(png).toString('base64')}`,
    );
  });

  it('keeps a turn with no picture as plain text, exactly as before', async () => {
    const { bodies } = await capture(request(), 'stream');
    const input = (bodies[0] as unknown as { input: Array<{ role: string; content: unknown }> })
      .input;
    const user = input.find((m) => m.role === 'user');
    expect(JSON.stringify(user?.content)).not.toContain('input_image');
  });
});
