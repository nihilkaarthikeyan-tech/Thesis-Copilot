/**
 * SSE over POST — PRD Appendix B.8, §9.3.
 *
 * Extracted so `/assist/suggest` and `/draft/section` share one implementation. The two CORS and
 * disconnect details below each cost a debugging session, and a second copy would eventually lose
 * one of them.
 */

import type { Env } from '@tc/config';
import type { FastifyReply, FastifyRequest } from 'fastify';

export type SseEvent = { event: string; data: unknown };

/**
 * Runs `produce` and writes what it yields as an event stream.
 *
 * The first event is pulled *before* the reply is hijacked, so a refusal thrown before the stream
 * opens (404, 409, 429) still reaches the problem-details filter and answers as JSON rather than
 * as a 200 with an error event.
 */
export async function streamSse(
  request: FastifyRequest,
  reply: FastifyReply,
  env: Env,
  produce: (signal: AbortSignal) => AsyncGenerator<SseEvent>,
): Promise<void> {
  // Not `request.raw.on('close')`: since Node 16 an IncomingMessage's `close` fires once the
  // request body has been fully read, which for a JSON POST is before the handler runs. A client
  // that goes away mid-stream shows up as the *response* closing early, or as the socket closing.
  const abort = new AbortController();
  const onClose = () => {
    if (!reply.raw.writableFinished) abort.abort();
  };
  reply.raw.on('close', onClose);
  request.raw.socket?.on('close', onClose);

  const stream = produce(abort.signal);
  const first = await stream.next();

  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    'x-accel-buffering': 'no',
    connection: 'keep-alive',
    'x-request-id': request.id,
    // Hijacking the reply skips Fastify's onSend hooks, and with them the CORS headers Nest would
    // otherwise add — the browser then blocks the stream with "No 'Access-Control-Allow-Origin'
    // header is present". They are written by hand here, from the configured APP_URL rather than
    // the request's own Origin.
    'access-control-allow-origin': env.APP_URL,
    'access-control-allow-credentials': 'true',
    vary: 'Origin',
  });
  raw.flushHeaders?.();

  const write = (event: string, data: unknown) => {
    if (raw.destroyed) return;
    raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    if (!first.done) write(first.value.event, first.value.data);
    for await (const event of stream) write(event.event, event.data);
  } catch (error) {
    write('error', {
      code: 'STREAM_FAILED',
      message: error instanceof Error ? error.message : 'Stream failed',
    });
  } finally {
    reply.raw.off('close', onClose);
    request.raw.socket?.off('close', onClose);
    if (!raw.destroyed) raw.end();
  }
}
