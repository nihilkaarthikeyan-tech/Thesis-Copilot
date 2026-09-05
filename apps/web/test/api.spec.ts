/**
 * The API fetch wrapper — PRD §9.
 *
 * The content-type rule below is here because getting it wrong is invisible: every unit and API
 * test passed while every upload made from the browser was rejected, because the wrapper stamped
 * `application/json` onto a multipart body and the server then tried to parse it as JSON.
 */

import { describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../src/lib/api.js';

function stubFetch(response: Response) {
  const spy = vi.fn(async () => response);
  vi.stubGlobal('fetch', spy);
  return spy;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function headersOf(spy: ReturnType<typeof stubFetch>): Record<string, string> {
  const init = spy.mock.calls[0]?.[1] as RequestInit | undefined;
  return (init?.headers ?? {}) as Record<string, string>;
}

describe('api()', () => {
  it('lets the browser set the content-type for a FormData upload', async () => {
    const spy = stubFetch(json({ ok: true }));
    const form = new FormData();
    form.append('file', new Blob(['%PDF-1.4'], { type: 'application/pdf' }), 'paper.pdf');

    await api('/documents/doc-1/seed-papers', { method: 'POST', body: form });

    // Anything we set here would be sent without the multipart boundary the server needs.
    expect(headersOf(spy)['content-type']).toBeUndefined();
  });

  it('sends JSON for a body we serialised ourselves', async () => {
    const spy = stubFetch(json({ ok: true }));
    await api('/documents', { method: 'POST', body: JSON.stringify({ title: 'A thesis' }) });
    expect(headersOf(spy)['content-type']).toBe('application/json');
  });

  it('sets no content-type on a GET', async () => {
    const spy = stubFetch(json([]));
    await api('/documents');
    expect(headersOf(spy)['content-type']).toBeUndefined();
  });

  it('sends the session cookie on every request', async () => {
    const spy = stubFetch(json([]));
    await api('/documents');
    const init = spy.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.credentials).toBe('include');
  });

  it('raises the problem details the API returned', async () => {
    stubFetch(json({ type: 'CAP_EXCEEDED', title: 'Monthly limit reached', status: 429 }, 429));
    await expect(api('/assist')).rejects.toBeInstanceOf(ApiError);
  });

  it('treats 204 as no content rather than failing to parse it', async () => {
    stubFetch(new Response(null, { status: 204 }));
    await expect(api('/sources/src-1')).resolves.toBeUndefined();
  });
});
