/**
 * Springer Nature Open Access API full text — PRD FR-2.2, ADR-0134.
 *
 * Springer, Nature, BMC and SpringerOpen answer a server's PDF download with a JavaScript bot
 * check (2026), which we must not get past (ADR-0054). Europe PMC covers what is deposited in
 * PMC; the rest of Springer Nature's gold and hybrid open access is served, with permission, by
 * the publisher's own Open Access API as JATS. It needs a free key (`SPRINGER_NATURE_API_KEY`).
 *
 * §0.3 rule 1 — the contract below was read from the API itself on 2026-10-09, with the key:
 *
 *   GET https://api.springernature.com/openaccess/jats?q=doi:10.1186/s12889-020-09301-4&api_key=…
 *   → 200 application/xml; no rate-limit headers (only `dois-downloaded: 1`):
 *     <response><apiMessage>…</apiMessage><query>doi:…</query><result><total>1</total>…</result>
 *     <records><article …><front>…<article-id pub-id-type="doi">10.1186/s12889-020-09301-4
 *     </article-id>…<permissions>…<license license-type="open-access" xlink:href="http://
 *     creativecommons.org/licenses/by/4.0/">…</permissions>…<abstract …><title>Abstract</title>
 *     <sec><title>Background</title><p>…</p></sec>…</abstract></front><body><sec id="Sec1">
 *     <title>Background</title><p id="Par13">… [<xref ref-type="bibr" rid="CR1">1</xref>] …</p>
 *     … <p><fig id="Fig1"><label>Fig. 1</label><caption><p>PRISMA flow diagram …</p></caption>
 *     <graphic …/></fig></p> … <table-wrap …>…</table-wrap>…</body><back><ack>…<ref-list>…
 *     </back></article></records></response>
 *   The same shape for BMC Public Health, Discover Food (Springer), Nature Communications,
 *   Annals of Operations Research (a hybrid article), EPJ C and Journal of Big Data (SpringerOpen).
 *
 *   A DOI that is not open access (a subscription article in the same hybrid journal), a book
 *   chapter outside the open-access set, and a DOI that does not exist all answer the same:
 *   → 404 {"status":"Fail","message":"No data was found for the given query.",…}
 *   A missing or wrong key → 401 {"status": "Fail","message": "Authentication failed. …"}.
 *   Any query other than `doi:` (journal, year) on the free plan → 403 "premium feature".
 *
 * The fixtures in `test/fixtures/scholarly/springer-*` are these responses, key removed.
 *
 * Limits: the Basic plan allows 100 requests a minute and 500 a day on the Open Access API
 * (dev.springernature.com, "Managing Rate Limits"; 429 past either). Nothing in the response
 * says how much is left, so the client spaces its own requests and the worker counts the day's.
 */

import type { SectionSpan } from '../chunker.js';
import { jatsToText } from './europepmc.js';
import { type FetchLike, RateLimiter } from './http.js';
import { attribute, elements, plainText } from './xml.js';

const API = 'https://api.springernature.com/openaccess/jats';

/** One a second: well inside the Basic plan's 100 a minute, and the call is rare. */
export const SPRINGER_REQUESTS_PER_SECOND = 1;

/** The Basic plan's daily allowance on the Open Access API. */
export const SPRINGER_DAILY_LIMIT = 500;

/**
 * How long to leave the API alone after a 429 when it does not say. The daily allowance is the
 * likelier cause than the per-minute one, and asking again every few seconds would only waste
 * time on every paper in the queue.
 */
export const SPRINGER_COOL_OFF_MS = 15 * 60_000;

/** A JATS answer bigger than this is not an article we can usefully read (the largest seen: 1.2 MB). */
export const SPRINGER_MAX_CHARS = 15_000_000;

/**
 * Crossref member 297, "Springer Science and Business Media LLC" — its DOI prefixes as Crossref
 * listed them on 2026-10-09 (`api.crossref.org/members/297`): Springer 10.1007, BMC 10.1186,
 * Nature 10.1038, EPJ 10.1140, Palgrave 10.1057, Kluwer 10.1023, Humana 10.1385 and the rest.
 * 10.21203 (Research Square preprints) is left out: it is not in the Open Access API.
 */
export const SPRINGER_NATURE_PREFIXES: ReadonlySet<string> = new Set([
  '10.1007',
  '10.1013',
  '10.1023',
  '10.1038',
  '10.1057',
  '10.1065',
  '10.1114',
  '10.1140',
  '10.1186',
  '10.1208',
  '10.1245',
  '10.1251',
  '10.1361',
  '10.1365',
  '10.1379',
  '10.1381',
  '10.1385',
  '10.1557',
  '10.1617',
  '10.2165',
  '10.3758',
  '10.3858',
  '10.4056',
  '10.4076',
  '10.4333',
  '10.5052',
  '10.5819',
  '10.7123',
  '10.7603',
  '10.7759',
  '10.17269',
  '10.17504',
  '10.19150',
  '10.26777',
  '10.26778',
  '10.33283',
]);

/** Crossref's member id for Springer Nature. */
const SPRINGER_NATURE_MEMBER = '297';

function normaliseDoi(doi: string | null | undefined): string | null {
  if (!doi) return null;
  const bare = doi
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:/i, '')
    .toLowerCase();
  return /^10\.\d{4,9}\/\S+$/.test(bare) ? bare : null;
}

/**
 * Whether a paper is Springer Nature's: its DOI prefix, or — when the record came from Crossref —
 * its `member` or `publisher` field. Anything else is not worth one of the day's 500 requests.
 */
export function isSpringerNatureDoi(
  doi: string | null | undefined,
  crossref?: { publisher?: unknown; member?: unknown } | null,
): boolean {
  const bare = normaliseDoi(doi);
  if (!bare) return false;
  if (SPRINGER_NATURE_PREFIXES.has(bare.slice(0, bare.indexOf('/')))) return true;
  if (crossref) {
    if (String(crossref.member ?? '') === SPRINGER_NATURE_MEMBER) return true;
    if (typeof crossref.publisher === 'string' && /springer/i.test(crossref.publisher)) return true;
  }
  return false;
}

export type SpringerFullText = {
  doi: string;
  text: string;
  sections: SectionSpan[];
  /** The licence the article states, e.g. `http://creativecommons.org/licenses/by/4.0/`. */
  license: string | null;
  /** The article page a person can open, for the log. */
  url: string;
};

/** Why no full text came back. Each is ordinary; none is thrown. */
export type SpringerFailure =
  /** 404: not in the open-access set (closed, or no such DOI — the API does not distinguish). */
  | 'no-record'
  /** A record came back but does not state an open-access licence. */
  | 'not-open-access'
  /** The record has no body (an abstract alone is not full text). */
  | 'no-body'
  /** 429, or still cooling off after one. */
  | 'rate-limited'
  /** The day's allowance is spent by our own count; nothing was sent. */
  | 'daily-limit'
  /** 401/403: the key is wrong or the plan does not allow the query. */
  | 'unauthorized'
  | 'timeout'
  | 'error';

export type SpringerOutcome =
  | ({ ok: true } & SpringerFullText)
  | { ok: false; reason: SpringerFailure; status?: number };

/**
 * Counts one request against today's allowance and says whether it may be sent. The worker backs
 * it with Redis (`dailyAllowance`), so a restart does not reset the count.
 */
export type AllowanceCheck = () => Promise<boolean>;

export type SpringerClientOptions = {
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  requestsPerSecond?: number;
  allowance?: AllowanceCheck;
  userAgent?: string;
};

export class SpringerNatureClient {
  private readonly doFetch: FetchLike;
  private readonly limiter: RateLimiter;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly allowance: AllowanceCheck | undefined;
  private readonly userAgent: string;
  /** No request before this time: set by a 429. */
  private coolOffUntil = 0;

  constructor(
    private readonly apiKey: string,
    options: SpringerClientOptions = {},
  ) {
    if (!apiKey) throw new Error('SpringerNatureClient needs an API key');
    this.doFetch = options.fetch ?? ((url, init) => fetch(url, init));
    this.sleep =
      options.sleep ??
      ((ms) => (ms <= 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, ms))));
    this.now = options.now ?? Date.now;
    this.limiter = new RateLimiter(
      options.requestsPerSecond ?? SPRINGER_REQUESTS_PER_SECOND,
      this.sleep,
      this.now,
    );
    this.allowance = options.allowance;
    this.userAgent = options.userAgent ?? 'ThesisCopilot/0.1';
  }

  /**
   * The open-access article with this DOI as text with a span per top-level section. One
   * request; one retry on a network fault or a 5xx. Never throws, and never puts the key (which
   * rides in the URL) into anything it returns.
   */
  async fullText(doi: string, signal?: AbortSignal): Promise<SpringerOutcome> {
    const wanted = normaliseDoi(doi);
    if (!wanted) return { ok: false, reason: 'no-record' };
    if (this.now() < this.coolOffUntil) return { ok: false, reason: 'rate-limited' };

    const url = `${API}?q=${encodeURIComponent(`doi:${wanted}`)}&api_key=${encodeURIComponent(this.apiKey)}`;

    for (let attempt = 1; attempt <= 2; attempt++) {
      if (this.allowance && !(await this.allowance())) return { ok: false, reason: 'daily-limit' };
      await this.limiter.acquire();
      if (signal?.aborted) return { ok: false, reason: 'timeout' };

      let response: Response;
      try {
        response = await this.doFetch(url, {
          headers: { accept: 'application/xml', 'user-agent': this.userAgent },
          ...(signal ? { signal } : {}),
        });
      } catch (error) {
        if (signal?.aborted || (error instanceof Error && error.name === 'TimeoutError')) {
          return { ok: false, reason: 'timeout' };
        }
        if (attempt < 2) {
          await this.sleep(1000);
          continue;
        }
        return { ok: false, reason: 'error' };
      }

      const { status } = response;
      if (status === 200) {
        let xml: string;
        try {
          xml = await response.text();
        } catch {
          return { ok: false, reason: signal?.aborted ? 'timeout' : 'error', status };
        }
        if (xml.length > SPRINGER_MAX_CHARS) return { ok: false, reason: 'error', status };
        return readArticle(xml, wanted);
      }

      await response.body?.cancel().catch(() => undefined);
      if (status === 404) return { ok: false, reason: 'no-record', status };
      if (status === 401 || status === 403) return { ok: false, reason: 'unauthorized', status };
      if (status === 429) {
        const seconds = Number(response.headers.get('retry-after'));
        this.coolOffUntil =
          this.now() +
          (Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : SPRINGER_COOL_OFF_MS);
        return { ok: false, reason: 'rate-limited', status };
      }
      if (status >= 500 && attempt < 2) {
        await this.sleep(1000);
        continue;
      }
      return { ok: false, reason: 'error', status };
    }
    return { ok: false, reason: 'error' };
  }
}

/**
 * The article in a `/openaccess/jats` response whose DOI is exactly the one asked for, as text.
 * It must state an open-access licence (`<license license-type="open-access">`) and have a body.
 */
export function readArticle(xml: string, doi: string): SpringerOutcome {
  const wanted = normaliseDoi(doi);
  const article = elements(xml, 'article').find(({ inner }) =>
    elements(inner, 'article-id').some(
      (id) =>
        attribute(id.attrs, 'pub-id-type') === 'doi' &&
        normaliseDoi(plainText(id.inner)) === wanted,
    ),
  );
  if (!article || !wanted) return { ok: false, reason: 'no-record' };

  const license = elements(article.inner, 'license').find(
    (l) => attribute(l.attrs, 'license-type') === 'open-access',
  );
  if (!license) return { ok: false, reason: 'not-open-access' };

  const parsed = jatsToText(article.inner);
  if (!parsed) return { ok: false, reason: 'no-body' };
  return {
    ok: true,
    doi: wanted,
    ...parsed,
    license: attribute(license.attrs, 'xlink:href'),
    url: `https://doi.org/${wanted}`,
  };
}

/** The part of a Redis client `dailyAllowance` needs (ioredis's INCR and EXPIRE). */
export type CounterStore = {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
};

/**
 * Today's (UTC) request count in `store`, shared by every process: true while it is within
 * `limit`. The API's own day may not be ours, so the caller leaves a margin under the plan.
 */
export function dailyAllowance(
  store: CounterStore,
  key: string,
  limit: number,
  now: () => number = Date.now,
): AllowanceCheck {
  return async () => {
    const day = new Date(now()).toISOString().slice(0, 10);
    const dayKey = `${key}:${day}`;
    const count = await store.incr(dayKey);
    if (count === 1) await store.expire(dayKey, 2 * 24 * 60 * 60);
    return count <= limit;
  };
}

/** A sentence for the log and the library, for each failure. */
export function readableSpringerReason(reason: SpringerFailure): string {
  switch (reason) {
    case 'no-record':
      return 'Springer Nature has no open-access full text for this DOI.';
    case 'not-open-access':
      return 'Springer Nature does not list this paper as open access.';
    case 'no-body':
      return 'Springer Nature has this paper only as an abstract.';
    case 'rate-limited':
      return "Springer Nature's service asked us to slow down.";
    case 'daily-limit':
      return "Today's Springer Nature allowance is used up.";
    case 'unauthorized':
      return 'The Springer Nature key was refused.';
    case 'timeout':
      return 'Springer Nature took too long to answer.';
    case 'error':
      return 'Springer Nature could not be reached.';
  }
}
