/**
 * Shared HTTP plumbing for the scholarly APIs — PRD FR-2.1, FR-2.2 and PHASES 2.5.
 *
 *   "Polite rate limiting (Crossref/OpenAlex etiquette headers, ≤ 5 req/s), retries with backoff"
 *
 * `fetch` is injected so every client is testable without a network (§0.3 rule 1: nothing here
 * assumes an API shape that has not been checked against a recorded response).
 */

import { type IndexHealth, nextMidnightUtc, readRefusal, scholarlyHealth } from './health.js';
import { type OpenAlexMeter, openAlexMeter } from './meter.js';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type ScholarlyClientOptions = {
  /** Contact address for the polite pool: `OPENALEX_MAILTO` / `CROSSREF_MAILTO` (PRD §13.3). */
  mailto: string;
  fetch?: FetchLike;
  /** Requests per second, shared across a client instance (PHASES 2.5: ≤ 5). */
  requestsPerSecond?: number;
  /** Attempts per request, including the first (PHASES 2.5: retries with backoff). */
  attempts?: number;
  /** Sleep hook, so tests do not actually wait. */
  sleep?: (ms: number) => Promise<void>;
  userAgent?: string;
  /**
   * Sent as the `api_key` query parameter on every request — the name both OpenAlex and NCBI
   * use. OpenAlex (2026) meters its API by cost: a caller without a key gets $0.10 of use a day,
   * about a hundred searches for the whole site, against a keyed caller's free $1
   * (`OPENALEX_API_KEY`). NCBI's raises PubMed's rate (`NCBI_API_KEY`, ADR-0020). Null and the
   * empty string both mean "none".
   */
  apiKey?: string | null;
  /**
   * Waits for permission to send one request, in place of the in-process limiter — for a service
   * whose limit is per operator rather than per process (arXiv, NCBI). See `sharedGate`.
   */
  gate?: () => Promise<void>;
  /**
   * ADR-0149: where this client reads and records the index's refusals. Defaults to the shared
   * `scholarlyHealth`; a test passes its own.
   */
  health?: IndexHealth;
  /** ADR-0149: where OpenAlex requests are counted against the day's budget. */
  meter?: OpenAlexMeter;
  now?: () => number;
};

export const DEFAULT_REQUESTS_PER_SECOND = 5;
export const DEFAULT_ATTEMPTS = 3;

const defaultSleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));

/** Serial queue that spaces calls to at most `requestsPerSecond`. */
export class RateLimiter {
  private next = 0;
  private readonly intervalMs: number;

  constructor(
    requestsPerSecond: number,
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
    private readonly now: () => number = Date.now,
  ) {
    this.intervalMs = 1000 / Math.max(requestsPerSecond, 0.001);
  }

  async acquire(): Promise<void> {
    const now = this.now();
    const at = Math.max(now, this.next);
    this.next = at + this.intervalMs;
    await this.sleep(at - now);
  }
}

export class ScholarlyError extends Error {
  /**
   * ADR-0149: the index is refusing us (a rate limit or a spent budget), as opposed to a fault
   * or a timeout — the difference between "try again later" and "something broke".
   */
  readonly refused: boolean;
  /** When the refusal is expected to end (ms), if the index said. */
  readonly until: number | null;

  constructor(
    readonly service: string,
    readonly status: number | null,
    message: string,
    options: { refused?: boolean; until?: number | null } = {},
  ) {
    super(`${service}: ${message}`);
    this.name = 'ScholarlyError';
    this.refused = options.refused ?? false;
    this.until = options.until ?? null;
  }
}

/** Status codes worth another attempt: transient server faults (429 has its own path). */
function retryable(status: number): boolean {
  return status === 408 || status >= 500;
}

export class ScholarlyHttp {
  readonly mailto: string;
  private readonly doFetch: FetchLike;
  private readonly acquire: () => Promise<void>;
  private readonly attempts: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly userAgent: string;
  private readonly apiKey: string | undefined;
  private readonly health: IndexHealth;
  private readonly meter: OpenAlexMeter;
  private readonly now: () => number;

  constructor(
    private readonly service: string,
    options: ScholarlyClientOptions,
  ) {
    this.mailto = options.mailto;
    this.apiKey = options.apiKey || undefined;
    this.health = options.health ?? scholarlyHealth;
    this.meter = options.meter ?? openAlexMeter;
    this.now = options.now ?? Date.now;
    this.doFetch = options.fetch ?? ((url, init) => fetch(url, init));
    this.sleep = options.sleep ?? defaultSleep;
    this.attempts = options.attempts ?? DEFAULT_ATTEMPTS;
    const limiter = new RateLimiter(
      options.requestsPerSecond ?? DEFAULT_REQUESTS_PER_SECOND,
      this.sleep,
    );
    this.acquire = options.gate ?? (() => limiter.acquire());
    // Crossref and OpenAlex both ask for a contact address in the User-Agent for the polite pool.
    this.userAgent = options.userAgent ?? `ThesisCopilot/0.1 (mailto:${options.mailto})`;
  }

  /** GETs JSON with polite rate limiting and exponential backoff. Returns null on 404. */
  async getJson<T>(url: string, signal?: AbortSignal): Promise<T | null> {
    const response = await this.get(url, 'application/json', signal);
    return response ? ((await response.json()) as T) : null;
  }

  /** The same, for the services that answer in XML (arXiv's Atom feed, PubMed's records). */
  async getText(url: string, accept: string, signal?: AbortSignal): Promise<string | null> {
    const response = await this.get(url, accept, signal);
    return response ? response.text() : null;
  }

  /**
   * A retry wait that the caller's signal can cut short. OpenAlex's 503 (2026-09-25) carries
   * `Retry-After: 60`, and honouring it twice held a student's proposal turn for two minutes; a
   * request-bound caller passes a timeout and gets its error in seconds, a background job
   * (no signal) still waits politely.
   */
  private async pause(ms: number, signal?: AbortSignal): Promise<void> {
    if (!signal) return this.sleep(ms);
    if (signal.aborted) return;
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<void>((resolve) => {
      onAbort = () => resolve();
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      await Promise.race([this.sleep(ms), aborted]);
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }
  }

  private async get(url: string, accept: string, signal?: AbortSignal): Promise<Response | null> {
    let lastError: ScholarlyError | null = null;
    // ADR-0149: an index known to be refusing is not asked again before it said to come back.
    // One request gets the first refusal; every other one in the window is answered from here.
    const refusedUntil = await this.health.refusedUntil(this.service);
    if (refusedUntil !== null) {
      throw new ScholarlyError(
        this.service,
        429,
        `refusing requests until ${new Date(refusedUntil).toISOString()}`,
        { refused: true, until: refusedUntil },
      );
    }
    // Added here, the one place every request passes, so no URL builder can forget it. Errors
    // carry the service and status only, so the key never reaches a log. ADR-0149: not while the
    // key's daily budget is known to be spent — the polite pool still answers then.
    let withKey = Boolean(this.apiKey) && (await this.health.keyUsable(this.service));
    const targetFor = (keyed: boolean) =>
      keyed && this.apiKey
        ? `${url}${url.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(this.apiKey)}`
        : url;

    let attempt = 0;
    let keylessRetry = false;
    while (attempt < this.attempts) {
      attempt += 1;
      await this.acquire();
      if (signal?.aborted) throw new ScholarlyError(this.service, null, 'aborted');

      let response: Response;
      try {
        response = await this.doFetch(targetFor(withKey), {
          headers: { accept, 'user-agent': this.userAgent },
          ...(signal ? { signal } : {}),
        });
      } catch (cause) {
        lastError = new ScholarlyError(
          this.service,
          null,
          cause instanceof Error ? cause.message : String(cause),
        );
        if (attempt < this.attempts) await this.pause(2 ** (attempt - 1) * 500, signal);
        continue;
      }

      // ADR-0149: anything OpenAlex answered (a refusal is not billed) counts against the day.
      if (this.service === 'openalex' && response.status !== 429) {
        void this.meter.record(url, withKey);
      }

      if (response.status === 404) return null;

      if (response.status === 429) {
        const refusal = await readRefusal(response);
        const now = this.now();
        const resetAt = now + (refusal.retryAfterMs ?? 0);
        if (withKey && refusal.budgetSpent && !keylessRetry) {
          // The key's budget is spent; the polite pool is a separate pool that still answers.
          // Once, at once, and remembered, so no other request pays for the lesson.
          await this.health.markKeyedExhausted(
            this.service,
            refusal.retryAfterMs ? resetAt : nextMidnightUtc(now),
            refusal.message,
          );
          withKey = false;
          keylessRetry = true;
          attempt -= 1;
          continue;
        }
        const waitMs = refusal.retryAfterMs ?? 2 ** (attempt - 1) * 500;
        // ADR-0050: a service that says "come back in an hour" (OpenAlex when the day's budget
        // is spent answers 429 with the seconds to midnight UTC) is a failure now, not a wait:
        // honouring it left a literature search on "Searching…" for as long as it asked.
        // ADR-0149: and it is remembered, so nothing hammers the index until then.
        if (waitMs > MAX_RETRY_AFTER_MS || attempt >= this.attempts) {
          const until = refusal.retryAfterMs ? resetAt : now + REFUSAL_BACKOFF_MS;
          await this.health.markRefused(this.service, until, refusal.message);
          throw new ScholarlyError(this.service, 429, refusal.message, { refused: true, until });
        }
        await this.pause(waitMs, signal);
        continue;
      }

      if (!response.ok) {
        lastError = new ScholarlyError(this.service, response.status, `HTTP ${response.status}`);
        if (attempt < this.attempts && retryable(response.status)) {
          const retryAfter = Number(response.headers.get('retry-after'));
          const waitMs =
            Number.isFinite(retryAfter) && retryAfter > 0
              ? retryAfter * 1000
              : 2 ** (attempt - 1) * 500;
          if (waitMs > MAX_RETRY_AFTER_MS) throw lastError;
          await this.pause(waitMs, signal);
          continue;
        }
        throw lastError;
      }

      await this.health.markAnswered(this.service);
      return response;
    }

    throw lastError ?? new ScholarlyError(this.service, null, 'exhausted retries');
  }
}

/**
 * ADR-0149: how long an index that answered 429 to every attempt without saying when to return
 * (Semantic Scholar sends no `Retry-After`) is left alone before the next request tries it.
 */
export const REFUSAL_BACKOFF_MS = 60_000;

/**
 * The longest `Retry-After` a request will wait out; anything longer fails the request. Two
 * minutes keeps OpenAlex's 60 s "busy" pause (2026-09-25) waited out in the background, and
 * refuses the hours a spent daily budget asks for.
 */
export const MAX_RETRY_AFTER_MS = 120_000;

/**
 * The part of a Redis client `sharedGate` needs — ioredis's `SET key value PX ms NX`. Structural,
 * so this package does not depend on a Redis library.
 */
export type SlotStore = {
  set(key: string, value: string, px: 'PX', ms: number, nx: 'NX'): Promise<'OK' | null>;
};

export type SharedGateOptions = {
  /** Give up after this long, rather than hold a request open behind a queue. */
  maxWaitMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

/**
 * At most one request per `intervalMs` across every process sharing `store` — the API and the
 * worker together.
 *
 * arXiv's terms are explicit that the limit applies "to all of the machines under your control
 * as a whole" (one request every three seconds), and NCBI counts per address. An in-process
 * limiter in each app would let two processes send twice the rate, so the slot lives in Redis:
 * whoever sets the key with NX may send one request, and nobody else can until its TTL — the
 * interval — runs out.
 */
export function sharedGate(
  service: string,
  store: SlotStore,
  key: string,
  intervalMs: number,
  options: SharedGateOptions = {},
): () => Promise<void> {
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const maxWaitMs = options.maxWaitMs ?? 60_000;
  const pollMs = options.pollMs ?? Math.min(250, intervalMs);
  return async () => {
    const deadline = now() + maxWaitMs;
    for (;;) {
      if ((await store.set(key, String(now()), 'PX', intervalMs, 'NX')) === 'OK') return;
      if (now() >= deadline) {
        throw new ScholarlyError(service, null, `no request slot within ${maxWaitMs} ms`);
      }
      await sleep(pollMs);
    }
  };
}
