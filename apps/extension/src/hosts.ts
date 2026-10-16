/**
 * The pages the in-page buttons are put on — ADR-0125. This list is the content script's
 * `matches` in the manifest (`scripts/build.mjs` reads it from here), and the service worker
 * answers a content script only from these hosts. Each one is in `STORE.md`'s permission
 * justification; adding a host means a new store review and a new install warning.
 *
 * - Google Scholar results (`/scholar?…`), on .com and on India's .co.in. No other Scholar page,
 *   and no other Google page: a robot-check page has no results, so it shows no buttons.
 * - PubMed: search results and article pages.
 * - arXiv: abstract pages, listings and search results.
 * - MDPI: its article pages (an MDPI issue or journal page gets no button: it names no article).
 *
 * Every other https page has the same script from a second manifest entry since 0.4.0 (ADR-0156,
 * `anywhere.ts`), which puts a button only beside an article its tags name or a DOI in its
 * reference list.
 */

export const INPAGE_MATCHES = [
  'https://scholar.google.com/scholar*',
  'https://scholar.google.co.in/scholar*',
  'https://pubmed.ncbi.nlm.nih.gov/*',
  'https://arxiv.org/abs/*',
  'https://arxiv.org/list/*',
  'https://arxiv.org/search/*',
  'https://www.mdpi.com/*',
] as const;

/** The hosts of `INPAGE_MATCHES`. */
export const INPAGE_HOSTS: readonly string[] = [
  ...new Set(INPAGE_MATCHES.map((pattern) => new URL(pattern.replace('*', '')).hostname)),
];

/**
 * Whether the service worker answers a request. The add-on's own pages (the popup, at
 * `ownOrigin`) may ask anything. A content script runs inside a site's page, so it may ask only
 * what the in-page card needs (`allowed`), and only from a tab on one of the in-page hosts.
 */
export function senderMay(
  sender: { url?: string; tab?: unknown },
  type: string,
  ownOrigin: string,
  allowed: readonly string[],
  /**
   * ADR-0154/0156: a content script may also ask from any other https tab — never from one of
   * `never` (this add-on's own site). Null: the five sites only.
   */
  anywhere: { never: (hostname: string) => boolean } | null = null,
): boolean {
  if (typeof sender.url === 'string' && sender.url.startsWith(ownOrigin)) return true;
  if (!sender.tab || !allowed.includes(type)) return false;
  if (isInpageUrl(sender.url)) return true;
  return anywhere !== null && isAnywhereUrl(sender.url, anywhere.never);
}

/** True for an https address the every-site buttons may run on. */
export function isAnywhereUrl(
  url: string | undefined,
  never: (hostname: string) => boolean,
): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !never(parsed.hostname);
  } catch {
    return false;
  }
}

/** True for an https address on one of the in-page hosts. */
export function isInpageUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && INPAGE_HOSTS.includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}
