/**
 * Open-access full-text fetch — PRD FR-2.2, PHASES 2.6.
 *
 * The URL under test comes from Unpaywall and points at a host we do not control, so these cases
 * are mostly about what happens when it misbehaves: a paywall page wearing a PDF content-type, a
 * file far bigger than any paper, a host that never answers.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  fetchOpenAccessPdf,
  MAX_PDF_BYTES,
  readableFullTextReason,
} from '../src/scholarly/fulltext.js';

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64, 0x20)]);

function respondWith(body: Buffer | string, init: ResponseInit = {}): Response {
  return new Response(typeof body === 'string' ? body : new Uint8Array(body), {
    status: 200,
    headers: { 'content-type': 'application/pdf' },
    ...init,
  });
}

describe('fetchOpenAccessPdf', () => {
  it('returns the bytes for a real PDF', async () => {
    const fetchFn = vi.fn(async () => respondWith(PDF));
    const result = await fetchOpenAccessPdf('https://repo.example.org/paper.pdf', {
      fetch: fetchFn,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bytes.subarray(0, 5).toString()).toBe('%PDF-');
      expect(result.url).toBe('https://repo.example.org/paper.pdf');
    }
  });

  it('follows redirects, because repositories always redirect', async () => {
    // Typed with the parameters, so `calls[0][1]` is the init rather than an empty tuple.
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => respondWith(PDF));
    await fetchOpenAccessPdf('https://doi.org/10.1/x', { fetch: fetchFn });
    const init = fetchFn.mock.calls[0]?.[1];
    expect(init?.redirect).toBe('follow');
  });

  it('has nothing to fetch when Unpaywall listed no PDF', async () => {
    const fetchFn = vi.fn(async () => respondWith(PDF));
    const result = await fetchOpenAccessPdf(null, { fetch: fetchFn });
    expect(result).toEqual({ ok: false, reason: 'no-location' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('refuses an HTML paywall page dressed as a PDF', async () => {
    // Common: the "open access" link resolves to a login page served as application/pdf.
    const fetchFn = vi.fn(async () => respondWith('<html><body>Sign in to continue</body></html>'));
    const result = await fetchOpenAccessPdf('https://publisher.example.com/x', { fetch: fetchFn });
    expect(result).toEqual({ ok: false, reason: 'not-a-pdf' });
  });

  it('reports a dead link rather than throwing', async () => {
    const fetchFn = vi.fn(async () => new Response('gone', { status: 404 }));
    const result = await fetchOpenAccessPdf('https://repo.example.org/gone.pdf', {
      fetch: fetchFn,
    });
    expect(result).toEqual({ ok: false, reason: 'not-ok' });
  });

  it('rejects a file the declared length already puts over the cap', async () => {
    const fetchFn = vi.fn(async () =>
      respondWith(PDF, {
        headers: {
          'content-type': 'application/pdf',
          'content-length': String(MAX_PDF_BYTES + 1),
        },
      }),
    );
    const result = await fetchOpenAccessPdf('https://repo.example.org/huge.pdf', {
      fetch: fetchFn,
    });
    expect(result).toEqual({ ok: false, reason: 'too-large' });
  });

  it('stops reading a body that exceeds the cap despite a small declared length', async () => {
    // A host can understate content-length, so the cap is enforced on the bytes as they arrive.
    const oversized = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(4096, 0x20)]);
    const fetchFn = vi.fn(async () =>
      respondWith(oversized, {
        headers: { 'content-type': 'application/pdf', 'content-length': '10' },
      }),
    );
    const result = await fetchOpenAccessPdf('https://repo.example.org/lying.pdf', {
      fetch: fetchFn,
      maxBytes: 1024,
    });
    expect(result).toEqual({ ok: false, reason: 'too-large' });
  });

  it('reports an unreachable host rather than failing the job', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const result = await fetchOpenAccessPdf('https://down.example.org/x.pdf', { fetch: fetchFn });
    expect(result).toEqual({ ok: false, reason: 'network' });
  });

  it('gives up on a host that never answers', async () => {
    const fetchFn = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    );
    const result = await fetchOpenAccessPdf('https://slow.example.org/x.pdf', {
      fetch: fetchFn,
      timeoutMs: 10,
    });
    expect(result).toEqual({ ok: false, reason: 'timeout' });
  });
});

describe('readableFullTextReason', () => {
  it('has a sentence for every failure the library can show', () => {
    const reasons = [
      'no-location',
      'not-ok',
      'not-a-pdf',
      'too-large',
      'timeout',
      'network',
    ] as const;
    for (const reason of reasons) {
      const sentence = readableFullTextReason(reason);
      expect(sentence.length, reason).toBeGreaterThan(10);
      expect(sentence.endsWith('.'), reason).toBe(true);
      // A student reads these; they must not name the service that failed or a status code.
      expect(sentence, reason).not.toMatch(/HTTP|\d{3}|Unpaywall/);
    }
  });
});
