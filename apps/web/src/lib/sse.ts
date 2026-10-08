/**
 * SSE over POST — PRD Appendix B.8: `fetch` + `ReadableStream` with an `AbortController`
 * (EventSource cannot POST). Turns the `/assist/suggest` stream into the `GhostEvent`s the
 * editor's ghost-text plugin consumes.
 */

import type { CloseTo, GhostEvent, GhostRequestPayload } from '@tc/ui';
import { API_URL, type ProblemDetails } from './api';

export async function* parseSse(
  response: Response,
): AsyncGenerator<{ event: string; data: string }> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf('\n\n');
      while (idx !== -1) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const event = /^event: (.+)$/m.exec(chunk)?.[1] ?? 'message';
        const data = chunk
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trimStart())
          .join('\n');
        yield { event, data };
        idx = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** The `request` the ghost-text extension calls (B.3). */
export async function* assistRequest(
  payload: GhostRequestPayload,
  signal: AbortSignal,
): AsyncGenerator<GhostEvent> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1/assist/suggest`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (error) {
    if (signal.aborted) return;
    yield {
      type: 'error',
      code: 'NETWORK',
      message: error instanceof Error ? error.message : 'Network error',
    };
    return;
  }

  if (!response.ok) {
    // Refusals (401, 404, 409 in-flight, 429 cap) are problem-details JSON, never a stream.
    const problem = (await response.json().catch(() => null)) as ProblemDetails | null;
    yield {
      type: 'error',
      code: problem?.type ?? `HTTP_${response.status}`,
      message: problem?.detail ?? problem?.title ?? 'The suggestion was refused.',
      // CAP_EXCEEDED carries when the cap resets (§6.2 cap-exceeded state).
      ...(typeof problem?.resetsAt === 'string' ? { resetsAt: problem.resetsAt } : {}),
      ...(typeof problem?.action === 'string' ? { action: problem.action } : {}),
      ...(typeof problem?.cap === 'number' ? { cap: problem.cap } : {}),
      // R31 (ADR-0122): the editor's limit message is built from the whole refusal.
      ...(problem && typeof problem === 'object' ? { problem } : {}),
    };
    return;
  }

  for await (const { event, data } of parseSse(response)) {
    if (signal.aborted) return;
    const parsed = data ? (JSON.parse(data) as Record<string, unknown>) : {};
    switch (event) {
      case 'start':
        yield { type: 'start', suggestionId: String(parsed.suggestionId) };
        break;
      case 'token':
        yield { type: 'token', t: String(parsed.t ?? '') };
        break;
      case 'done':
        yield {
          type: 'done',
          citations:
            (parsed.citations as GhostEvent extends { type: 'done'; citations: infer C }
              ? C
              : never) ?? [],
          ...(typeof parsed.text === 'string' ? { text: parsed.text } : {}),
          ...(typeof parsed.grounded === 'boolean' ? { grounded: parsed.grounded } : {}),
          ...(typeof parsed.pinned === 'number' ? { pinned: parsed.pinned } : {}),
          ...(typeof parsed.findingSources === 'boolean'
            ? { findingSources: parsed.findingSources }
            : {}),
          ...(typeof parsed.needsSource === 'string' ? { needsSource: parsed.needsSource } : {}),
          ...(parsed.papersLoading === true ? { papersLoading: true } : {}),
          ...(parsed.closeTo && typeof parsed.closeTo === 'object'
            ? { closeTo: parsed.closeTo as CloseTo }
            : {}),
          usage: parsed.usage,
          ttfbMs: typeof parsed.ttfbMs === 'number' ? parsed.ttfbMs : undefined,
          latencyMs: typeof parsed.latencyMs === 'number' ? parsed.latencyMs : undefined,
        };
        break;
      case 'error':
        yield {
          type: 'error',
          code: String(parsed.code ?? 'ERROR'),
          message: String(parsed.message ?? ''),
        };
        break;
      default:
        break;
    }
  }
}
