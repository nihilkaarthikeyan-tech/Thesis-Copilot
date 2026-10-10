/**
 * MDPI's open-access PDFs, fetched by the server — ADR-0154.
 *
 * Every MDPI article is open access, and Unpaywall lists its PDF at MDPI's own address
 * (`https://www.mdpi.com/1996-1073/18/8/1921/pdf?version=1744253740`). That host sits behind a bot
 * manager: observed 2026-10-10 from one machine within minutes, the same address answered the PDF
 * (200, no content-type, `attachment; filename="energies-18-01921.pdf"`), then a "verify" page
 * (200, text/html, a meta refresh carrying a `bm-verify` token), then 403. Nothing here answers
 * that page — getting past a bot check is not ours to do (ADR-0101).
 *
 * The file itself is served from MDPI's file host, `mdpi-res.com`, at
 * `/d_attachment/<journal>/<journal>-<volume>-<article, 5 digits>/article_deploy/<same>.pdf`,
 * which answered `application/pdf` every time it was asked that day. The journal's code there is
 * the journal's name in lower case for the journals whose code is their name (Energies →
 * `energies`, Remote Sensing → `remotesensing`, both observed); for one whose code is not
 * (Applied Sciences is `applsci`) the address built is simply not found, and MDPI's own address
 * is tried as before. No table of codes is kept: a guessed code would be invented data.
 *
 * Because an address built by rule could in principle name another paper, a file from it counts
 * only when its bytes contain the paper's DOI (MDPI's PDFs carry it in their "check for updates"
 * link). Every hop must stay on MDPI's hosts, the answer must say it is a PDF, and the size cap
 * is the full-text fetcher's.
 *
 * Pure apart from the fetch, so it is tested with a recorded chain.
 */

import { type FullTextFetchOptions, type FullTextResult, fetchOpenAccessPdf } from './fulltext.js';

/** MDPI's DOI prefix. */
export const MDPI_DOI_PREFIX = '10.3390/';

/** The only hosts an MDPI fetch may touch, redirects included. */
export const MDPI_HOSTS: readonly string[] = [
  'www.mdpi.com',
  'mdpi.com',
  'mdpi-res.com',
  'www.mdpi-res.com',
];

export const isMdpiDoi = (doi: string | null | undefined): boolean =>
  typeof doi === 'string' && doi.trim().toLowerCase().startsWith(MDPI_DOI_PREFIX);

/** Where an MDPI article sits: its journal's ISSN, volume, issue and article number. */
export type MdpiArticle = { issn: string; volume: string; issue: string; article: string };

/** `https://www.mdpi.com/1996-1073/18/8/1921/pdf?version=…` → its parts; null for anything else. */
export function mdpiArticleFromUrl(url: string): MdpiArticle | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== 'www.mdpi.com' && host !== 'mdpi.com') return null;
  const match = /^\/(\d{4}-\d{3}[\dXx])\/(\d{1,3})\/(\d{1,3})\/(\d{1,6})(?:\/pdf)?\/?$/.exec(
    parsed.pathname,
  );
  if (!match) return null;
  const [, issn = '', volume = '', issue = '', article = ''] = match;
  return { issn: issn.toUpperCase(), volume, issue, article };
}

/** The journal's code on MDPI's file host when it is the name itself: letters and digits only. */
export function mdpiJournalCode(journal: string | null | undefined): string | null {
  const code = (journal ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return code.length >= 2 && code.length <= 40 ? code : null;
}

/** The file-host address for an article, or null without a usable journal code. */
export function mdpiFileUrl(
  article: MdpiArticle,
  journal: string | null | undefined,
): string | null {
  const code = mdpiJournalCode(journal);
  if (!code) return null;
  const name = `${code}-${Number(article.volume)}-${article.article.padStart(5, '0')}`;
  return `https://mdpi-res.com/d_attachment/${code}/${name}/article_deploy/${name}.pdf`;
}

/**
 * The addresses to try for an MDPI paper, best first: the file host's (built from the journal's
 * name and the article's place, `mustContain` its DOI), then each of MDPI's own addresses
 * Unpaywall listed. `journal` is the record's journal name (Crossref's `container-title`).
 */
export function mdpiPdfCandidates(input: {
  doi: string;
  pdfUrls: readonly string[];
  journal: string | null | undefined;
  /** From the record when Unpaywall listed no MDPI address: volume and article number. */
  volume?: string | null;
  article?: string | null;
}): Array<{ url: string; checkDoi: boolean }> {
  const own = input.pdfUrls.filter((url) => mdpiArticleFromUrl(url) !== null);
  const place =
    own.map(mdpiArticleFromUrl).find((a): a is MdpiArticle => a !== null) ??
    (input.volume &&
    /^\d{1,3}$/.test(input.volume) &&
    input.article &&
    /^\d{1,6}$/.test(input.article)
      ? { issn: '', volume: input.volume, issue: '', article: input.article }
      : null);
  const out: Array<{ url: string; checkDoi: boolean }> = [];
  const file = place ? mdpiFileUrl(place, input.journal) : null;
  if (file) out.push({ url: file, checkDoi: true });
  for (const url of own) out.push({ url, checkDoi: false });
  return out;
}

/** Fetches one MDPI address under MDPI's rules (hosts, type, size, and the DOI when asked). */
export function fetchMdpiPdf(
  url: string,
  doi: string,
  checkDoi: boolean,
  options: Pick<FullTextFetchOptions, 'fetch' | 'maxBytes' | 'timeoutMs'> = {},
): Promise<FullTextResult> {
  return fetchOpenAccessPdf(url, {
    ...options,
    allowHosts: MDPI_HOSTS,
    requirePdfType: true,
    ...(checkDoi ? { mustContain: doi.trim() } : {}),
  });
}
