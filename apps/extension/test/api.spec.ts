/**
 * The add-on's requests (ADR-0069), against a fake `fetch`. Pinned: every call goes to the one
 * API host with the session cookie and no token; an id that is not a UUID never reaches a path;
 * 401 reads as signed out; a problem-details message is passed on, cut to length; a PDF is only a
 * PDF when its bytes say so, and is refused over 50 MB.
 */

import { describe, expect, it } from 'vitest';
import { fetchPdf, isId, makeApi, PDF_MAX_BYTES } from '../src/api.js';

const BASE = 'https://thesis.rademics.ai';
const DOC = '0190a3c4-0000-7000-8000-000000000001';

type Seen = { url: string; init: RequestInit };

function fakeFetch(respond: (url: string, init: RequestInit) => Response) {
  const seen: Seen[] = [];
  const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    seen.push({ url, init });
    return respond(url, init);
  }) as typeof fetch;
  return { fetcher, seen };
}

const headerOf = (seen: Seen | undefined, name: string): string | undefined =>
  (seen?.init.headers as Record<string, string> | undefined)?.[name];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('calls to Thesis Copilot', () => {
  it('go to the API host with the session cookie and no token', async () => {
    const { fetcher, seen } = fakeFetch(() =>
      json([
        { id: DOC, title: 'Groundwater' },
        { id: 'not-a-uuid', title: 'x' },
      ]),
    );
    const reply = await makeApi(BASE, fetcher).theses();
    expect(reply).toEqual({ ok: true, value: [{ id: DOC, title: 'Groundwater' }] });
    expect(seen[0]?.url).toBe(`${BASE}/api/v1/documents`);
    expect(seen[0]?.init.credentials).toBe('include');
    expect(JSON.stringify(seen[0]?.init.headers)).not.toMatch(/authorization/i);
  });

  it('never put an id that is not a UUID into a path', async () => {
    const { fetcher, seen } = fakeFetch(() => json([]));
    const api = makeApi(BASE, fetcher);
    const reply = await api.library('../../admin');
    expect(reply.ok).toBe(false);
    expect(await api.addToCollection('x/../y', [DOC])).toMatchObject({ ok: false, status: 400 });
    expect(seen).toHaveLength(0);
    expect(isId(DOC)).toBe(true);
    expect(isId(`${DOC}/x`)).toBe(false);
  });

  it('read 401 as signed out, and pass on a problem-details message', async () => {
    const signedOut = makeApi(BASE, fakeFetch(() => json({ title: 'Unauthorized' }, 401)).fetcher);
    expect(await signedOut.theses()).toEqual({
      ok: false,
      status: 401,
      message: 'You are signed out of Thesis Copilot.',
    });

    const limited = makeApi(
      BASE,
      fakeFetch(() => json({ title: 'Too many', detail: 'x'.repeat(900) }, 429)).fetcher,
    );
    const reply = await limited.theses();
    expect(reply).toMatchObject({ ok: false, status: 429 });
    expect(!reply.ok && reply.message).toHaveLength(300);

    const offline = makeApi(BASE, (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch);
    expect(await offline.theses()).toMatchObject({ ok: false, status: 0 });
  });

  it('send resolve as JSON and line the answered ids up with the references', async () => {
    const { fetcher, seen } = fakeFetch(() =>
      json({ queued: 1, alreadyPresent: 0, sourceIds: [DOC, 'junk'] }),
    );
    const reply = await makeApi(BASE, fetcher).resolve(DOC, [
      { raw: 'A' },
      { raw: 'B', doi: '10.1/x' },
    ]);
    expect(reply).toEqual({ ok: true, value: { sourceIds: [DOC, null] } });
    expect(seen[0]?.url).toBe(`${BASE}/api/v1/documents/${DOC}/sources/resolve`);
    expect(headerOf(seen[0], 'content-type')).toBe('application/json');
    expect(JSON.parse(String(seen[0]?.init.body))).toEqual({
      references: [{ raw: 'A' }, { raw: 'B', doi: '10.1/x' }],
    });
  });

  it('upload a PDF as multipart, letting the browser set the boundary', async () => {
    const { fetcher, seen } = fakeFetch(() => json({ id: DOC }, 201));
    await makeApi(BASE, fetcher).uploadPdf(DOC, new Blob(['%PDF-']), 'paper.pdf');
    expect(seen[0]?.url).toBe(`${BASE}/api/v1/documents/${DOC}/sources/upload`);
    expect(seen[0]?.init.body).toBeInstanceOf(FormData);
    expect(headerOf(seen[0], 'content-type')).toBeUndefined();
    const form = seen[0]?.init.body as FormData;
    const file = form.get('file') as File;
    expect(file.name).toBe('paper.pdf');
  });
});

describe('fetching the tab’s PDF', () => {
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);

  it('takes the file with the student’s cookies for that site', async () => {
    const { fetcher, seen } = fakeFetch(() => new Response(pdfBytes, { status: 200 }));
    const reply = await fetchPdf('https://example.org/a.pdf', fetcher);
    expect(reply.ok).toBe(true);
    expect(seen[0]?.init.credentials).toBe('include');
  });

  it('refuses a sign-in page, a refusal, a huge file and a non-web address', async () => {
    const html = fakeFetch(() => new Response('<html>Sign in</html>', { status: 200 }));
    expect(await fetchPdf('https://example.org/a.pdf', html.fetcher)).toMatchObject({ ok: false });
    const refused = fakeFetch(() => new Response('', { status: 403 }));
    expect(await fetchPdf('https://example.org/a.pdf', refused.fetcher)).toEqual({
      ok: false,
      message: 'The site refused the PDF (403).',
    });
    const huge = fakeFetch(
      () =>
        new Response(pdfBytes, {
          status: 200,
          headers: { 'content-length': String(PDF_MAX_BYTES + 1) },
        }),
    );
    expect(await fetchPdf('https://example.org/a.pdf', huge.fetcher)).toMatchObject({ ok: false });
    const local = fakeFetch(() => new Response(pdfBytes));
    expect(await fetchPdf('file:///C:/a.pdf', local.fetcher)).toMatchObject({ ok: false });
    expect(local.seen).toHaveLength(0);
    const blocked = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    expect(await fetchPdf('https://example.org/a.pdf', blocked)).toEqual({
      ok: false,
      message: 'This site would not let the add-on download the PDF.',
    });
  });
});
