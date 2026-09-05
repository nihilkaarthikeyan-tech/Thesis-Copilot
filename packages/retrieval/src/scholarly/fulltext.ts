/**
 * Open-access full-text fetch — PRD FR-2.2 and PHASES 1-W2 task 2.6.
 *
 *   "Unpaywall `best_oa_location.pdf_url` → download → object storage →
 *    `groundingLevel: FULL_TEXT`; … else abstract only → `ABSTRACT`."
 *
 * The URL here comes from Unpaywall, which means it points at a repository or publisher we have
 * never seen and do not control. It is treated as untrusted input throughout: the response is
 * capped, checked to actually be a PDF, and a failure downgrades the source to abstract-only
 * rather than propagating. A paper we cannot read is a smaller problem than a job that dies.
 */

import type { FetchLike } from './http.js';

/** FREE_TRIAL's per-file ceiling in PRD §11.3; a single OA paper above this is not worth chasing. */
export const MAX_PDF_BYTES = 25 * 1024 * 1024;

/** Repositories redirect a lot (DOI → landing page → CDN), but a loop is not a redirect chain. */
export const MAX_REDIRECTS = 5;

export const FETCH_TIMEOUT_MS = 30_000;

export type FullTextFetchOptions = {
  fetch?: FetchLike;
  maxBytes?: number;
  timeoutMs?: number;
};

export type FullTextResult =
  | { ok: true; bytes: Buffer; contentType: string; url: string }
  | { ok: false; reason: FullTextFailure };

/** Why a fetch did not produce a PDF. Each maps to something the library can say plainly. */
export type FullTextFailure =
  | 'no-location'
  | 'not-ok'
  | 'not-a-pdf'
  | 'too-large'
  | 'timeout'
  | 'network';

/** The PDF magic bytes. A publisher serving an HTML paywall page with a PDF content-type is common. */
function looksLikePdf(bytes: Buffer): boolean {
  return bytes.subarray(0, 5).toString('latin1') === '%PDF-';
}

/**
 * Downloads an open-access PDF. Returns a reason rather than throwing, because every failure here
 * is expected often enough to be ordinary: link rot, a paywall behind an "open access" flag, a
 * repository that is down.
 */
export async function fetchOpenAccessPdf(
  url: string | null | undefined,
  options: FullTextFetchOptions = {},
): Promise<FullTextResult> {
  if (!url) return { ok: false, reason: 'no-location' };

  const doFetch = options.fetch ?? ((target, init) => fetch(target, init));
  const maxBytes = options.maxBytes ?? MAX_PDF_BYTES;
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await doFetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { accept: 'application/pdf,*/*' },
    });

    if (!response.ok) return { ok: false, reason: 'not-ok' };

    // Trust the declared length when it rules the file out, but never when it says the file is
    // small: a server can lie or omit it, so the body is measured as it arrives.
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      return { ok: false, reason: 'too-large' };
    }

    const bytes = await readCapped(response, maxBytes);
    if (!bytes) return { ok: false, reason: 'too-large' };
    if (!looksLikePdf(bytes)) return { ok: false, reason: 'not-a-pdf' };

    return {
      ok: true,
      bytes,
      contentType: response.headers.get('content-type') ?? 'application/pdf',
      url,
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return { ok: false, reason: aborted ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

/** Reads the body, stopping the moment it exceeds the cap rather than buffering the whole thing. */
async function readCapped(response: Response, maxBytes: number): Promise<Buffer | null> {
  const body = response.body;
  if (!body) {
    const whole = Buffer.from(await response.arrayBuffer());
    return whole.length > maxBytes ? null : whole;
  }

  const reader = body.getReader();
  const parts: Buffer[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) return null;
      parts.push(Buffer.from(value));
    }
  } finally {
    // A caller that stopped early must not leave the socket open.
    await reader.cancel().catch(() => undefined);
  }

  return Buffer.concat(parts);
}

/** A sentence for the library, for each way a full-text fetch can fail. */
export function readableFullTextReason(reason: FullTextFailure): string {
  switch (reason) {
    case 'no-location':
      return 'No open-access copy was listed for this paper.';
    case 'not-ok':
      return 'The open-access link did not work.';
    case 'not-a-pdf':
      return 'The open-access link led to a page rather than a PDF.';
    case 'too-large':
      return 'The open-access PDF was too large to read.';
    case 'timeout':
      return 'The open-access host took too long to answer.';
    case 'network':
      return 'The open-access host could not be reached.';
  }
}
