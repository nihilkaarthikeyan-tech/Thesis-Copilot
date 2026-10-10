/**
 * MDPI's open-access PDFs — ADR-0154.
 *
 * The answers below are the ones MDPI's hosts gave on 2026-10-10 for Energies 18(8) 1921
 * (DOI 10.3390/en18081921), written down from what was observed — status, headers and the start
 * of the body — with the file itself replaced by a few stand-in bytes. One chain is not observed
 * and says so: a redirect from MDPI's own address to its file host, the shape a browser is
 * described as getting, kept to prove a redirect that stays on MDPI's hosts is followed and one
 * that leaves them is not.
 */

import { describe, expect, it, vi } from 'vitest';
import { saysPdf } from '../src/scholarly/fulltext.js';
import {
  fetchMdpiPdf,
  isMdpiDoi,
  mdpiArticleFromUrl,
  mdpiFileUrl,
  mdpiJournalCode,
  mdpiPdfCandidates,
} from '../src/scholarly/mdpi.js';

const DOI = '10.3390/en18081921';
const OWN = 'https://www.mdpi.com/1996-1073/18/8/1921/pdf?version=1744253740';
const FILE =
  'https://mdpi-res.com/d_attachment/energies/energies-18-01921/article_deploy/energies-18-01921.pdf';

/** A stand-in PDF carrying the DOI the way MDPI's do, in its "check for updates" link. */
const PDF_WITH_DOI = Buffer.from(
  `%PDF-1.7\n1 0 obj <</URI(https://www.mdpi.com/article/${DOI}?type=check_update&version=1)>>\n`,
);
const PDF_WITHOUT_DOI = Buffer.from('%PDF-1.7\n1 0 obj <</Title(Some other paper)>>\n');

/** The "verify" page MDPI's own host answered with (its start, as observed; token shortened). */
const VERIFY_PAGE =
  '<!DOCTYPE html><html><head> <meta charset="utf-8"> <meta http-equiv="refresh" content="5; URL=\'/1996-1073/18/8/1921/pdf?bm-verify=AAQAAAAO\'"></head><body></body></html>';

type Answer = { status: number; headers?: Record<string, string>; body?: Buffer | string };

/** A fake network answering from a table of addresses, recording what was asked. */
function network(table: Record<string, Answer>) {
  const asked: string[] = [];
  const fetch = vi.fn(async (url: string, _init?: RequestInit) => {
    asked.push(url);
    const answer = table[url] ?? { status: 404, body: 'not found' };
    const body = answer.body;
    return new Response(
      body === undefined ? null : typeof body === 'string' ? body : new Uint8Array(body),
      { status: answer.status, headers: answer.headers ?? {} },
    );
  });
  return { fetch, asked };
}

describe('MDPI addresses', () => {
  it('knows an MDPI DOI and reads the article out of MDPI’s own PDF address', () => {
    expect(isMdpiDoi(DOI)).toBe(true);
    expect(isMdpiDoi('10.1038/nature12373')).toBe(false);
    expect(mdpiArticleFromUrl(OWN)).toEqual({
      issn: '1996-1073',
      volume: '18',
      issue: '8',
      article: '1921',
    });
    expect(mdpiArticleFromUrl('https://www.mdpi.com/1996-1073/18/8')).toBeNull();
    expect(mdpiArticleFromUrl('https://evil.example/1996-1073/18/8/1921/pdf')).toBeNull();
  });

  it('builds the file host’s address from the journal’s name and the article’s place', () => {
    expect(mdpiJournalCode('Energies')).toBe('energies');
    expect(mdpiJournalCode('Remote Sensing')).toBe('remotesensing');
    expect(mdpiJournalCode('')).toBeNull();
    const place = mdpiArticleFromUrl(OWN);
    expect(place && mdpiFileUrl(place, 'Energies')).toBe(FILE);
  });

  it('tries the file host first, with the DOI check, then MDPI’s own address', () => {
    expect(mdpiPdfCandidates({ doi: DOI, pdfUrls: [OWN], journal: 'Energies' })).toEqual([
      { url: FILE, checkDoi: true },
      { url: OWN, checkDoi: false },
    ]);
    // No Unpaywall address: the record's volume and article number place it.
    expect(
      mdpiPdfCandidates({
        doi: DOI,
        pdfUrls: [],
        journal: 'Energies',
        volume: '18',
        article: '1921',
      }),
    ).toEqual([{ url: FILE, checkDoi: true }]);
    // No journal name: only MDPI's own address.
    expect(mdpiPdfCandidates({ doi: DOI, pdfUrls: [OWN], journal: null })).toEqual([
      { url: OWN, checkDoi: false },
    ]);
  });
});

describe('saysPdf', () => {
  it('takes application/pdf, or a typeless download named .pdf, and nothing else', () => {
    expect(saysPdf(new Headers({ 'content-type': 'application/pdf' }))).toBe(true);
    expect(
      saysPdf(
        new Headers({ 'content-disposition': 'attachment; filename="energies-18-01921.pdf"' }),
      ),
    ).toBe(true);
    expect(
      saysPdf(
        new Headers({
          'content-type': 'application/octet-stream',
          'content-disposition': 'attachment; filename=paper.pdf',
        }),
      ),
    ).toBe(true);
    expect(saysPdf(new Headers({ 'content-type': 'text/html' }))).toBe(false);
    expect(saysPdf(new Headers({}))).toBe(false);
    expect(
      saysPdf(
        new Headers({ 'content-type': 'text/html', 'content-disposition': 'filename="x.pdf"' }),
      ),
    ).toBe(false);
  });
});

describe('fetchMdpiPdf', () => {
  it('reads the file host’s PDF (observed: 200 application/pdf)', async () => {
    const { fetch } = network({
      [FILE]: {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': 'attachment; filename="energies-18-01921.pdf"',
        },
        body: PDF_WITH_DOI,
      },
    });
    const result = await fetchMdpiPdf(FILE, DOI, true, { fetch });
    expect(result.ok).toBe(true);
  });

  it('reads MDPI’s own answer with no content-type when it names a .pdf (observed)', async () => {
    const { fetch } = network({
      [OWN]: {
        status: 200,
        headers: { 'content-disposition': 'attachment; filename="energies-18-01921.pdf"' },
        body: PDF_WITH_DOI,
      },
    });
    expect((await fetchMdpiPdf(OWN, DOI, false, { fetch })).ok).toBe(true);
  });

  it('does not answer the "verify" page or the 403 (observed), and says why', async () => {
    const verify = network({
      [OWN]: { status: 200, headers: { 'content-type': 'text/html' }, body: VERIFY_PAGE },
    });
    expect(await fetchMdpiPdf(OWN, DOI, false, { fetch: verify.fetch })).toEqual({
      ok: false,
      reason: 'not-a-pdf',
    });
    // The meta refresh is not followed: one request, no second one with the token.
    expect(verify.asked).toEqual([OWN]);

    const refused = network({ [OWN]: { status: 403, headers: { 'content-type': 'text/html' } } });
    expect(await fetchMdpiPdf(OWN, DOI, false, { fetch: refused.fetch })).toEqual({
      ok: false,
      reason: 'not-ok',
    });
  });

  it('refuses a file from a built address that does not name the paper’s DOI', async () => {
    const { fetch } = network({
      [FILE]: {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
        body: PDF_WITHOUT_DOI,
      },
    });
    expect(await fetchMdpiPdf(FILE, DOI, true, { fetch })).toEqual({
      ok: false,
      reason: 'not-a-pdf',
    });
  });

  it('follows a redirect that stays on MDPI’s hosts (a chain in the described shape)', async () => {
    const { fetch, asked } = network({
      [OWN]: { status: 302, headers: { location: FILE } },
      [FILE]: { status: 200, headers: { 'content-type': 'application/pdf' }, body: PDF_WITH_DOI },
    });
    expect((await fetchMdpiPdf(OWN, DOI, false, { fetch })).ok).toBe(true);
    expect(asked).toEqual([OWN, FILE]);
  });

  it('stops at a redirect off MDPI’s hosts without asking that host anything', async () => {
    const elsewhere = 'https://files.example.net/energies-18-01921.pdf';
    const { fetch, asked } = network({
      [OWN]: { status: 302, headers: { location: elsewhere } },
      [elsewhere]: {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
        body: PDF_WITH_DOI,
      },
    });
    expect(await fetchMdpiPdf(OWN, DOI, false, { fetch })).toEqual({ ok: false, reason: 'not-ok' });
    expect(asked).toEqual([OWN]);
  });

  it('stops at a redirect to plain http, even on an MDPI host', async () => {
    const { fetch, asked } = network({
      [OWN]: { status: 301, headers: { location: 'http://mdpi-res.com/x.pdf' } },
    });
    expect(await fetchMdpiPdf(OWN, DOI, false, { fetch })).toEqual({ ok: false, reason: 'not-ok' });
    expect(asked).toEqual([OWN]);
  });

  it('keeps the size limit', async () => {
    const { fetch } = network({
      [FILE]: {
        status: 200,
        headers: { 'content-type': 'application/pdf', 'content-length': String(1024 * 1024) },
        body: PDF_WITH_DOI,
      },
    });
    expect(await fetchMdpiPdf(FILE, DOI, true, { fetch, maxBytes: 1024 })).toEqual({
      ok: false,
      reason: 'too-large',
    });
  });
});
