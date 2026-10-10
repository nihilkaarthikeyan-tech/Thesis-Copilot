/**
 * Shared HTTP plumbing for the scholarly APIs — PRD FR-2.1, FR-2.2 and PHASES 2.5.
 *
 *   "Polite rate limiting (Crossref/OpenAlex etiquette headers, ≤ 5 req/s), retries with backoff"
 *
 * `fetch` is injected so every client is testable without a network (§0.3 rule 1: nothing here
 * assumes an API shape that has not been checked against a recorded response).
 */

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
  constructor(
    readonly service: string,
    readonly status: number | null,
    message: string,
  ) {
    super(`${service}: ${message}`);
    this.name = 'ScholarlyError';
  }
}

/**
 * How long a refused response asks us to wait, in ms; 0 when it does not say. The `Retry-After`
 * header first (seconds; OpenAlex's 503 of 2026-09-25 carried 60). OpenAlex's spent-budget 429
 * (2026-10-10) says it in the JSON body instead — `{"retryAfter": 13177, "dailyRemainingUsd": 0,
 * …}`, the seconds to midnight UTC — so the body is read when the header is silent.
 */
async function retryAfterOf(response: Response): Promise<number> {
  const header = Number(response.headers.get('retry-after'));
  if (Number.isFinite(header) && header > 0) return header * 1000;
  try {
    const body = (await response.json()) as { retryAfter?: unknown } | null;
    const seconds = Number(body?.retryAfter);
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
  } catch {
    return 0;
  }
}

/** Status codes worth another attempt: rate limiting and transient server faults. */
function retryable(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

export class ScholarlyHttp {
  readonly mailto: string;
  private readonly doFetch: FetchLike;
  private readonly acquire: () => Promise<void>;
  private readonly attempts: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly userAgent: string;
  private readonly apiKey: string | undefined;

  constructor(
    private readonly service: string,
    options: ScholarlyClientOptions,
  ) {
    this.mailto = options.mailto;
    this.apiKey = options.apiKey || undefined;
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

  /**
   * The key's daily budget is spent until this time (ms since epoch), and requests go without it
   * (ADR-0145 addendum, 2026-10-10). OpenAlex meters a key at $1 a day; a day of real-model test
   * runs spent it, every keyed request then answered 429 "you only have $0 remaining. Resets at
   * midnight UTC", and a new thesis found no papers for eight minutes — while the same request
   * without the key, in the polite pool, answered 200.
   */
  private keySpentUntil = 0;

  /** Whether the key is sent on the next request: set, and not known to be spent. */
  keyInUse(now: number = Date.now()): boolean {
    return this.apiKey !== undefined && now >= this.keySpentUntil;
  }

  private withKey(url: string): string {
    return this.apiKey
      ? `${url}${url.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(this.apiKey)}`
      : url;
  }

  private async get(url: string, accept: string, signal?: AbortSignal): Promise<Response | null> {
    let lastError: ScholarlyError | null = null;

    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      await this.acquire();
      if (signal?.aborted) throw new ScholarlyError(this.service, null, 'aborted');
      // Added here, the one place every request passes, so no URL builder can forget it. Errors
      // carry the service and status only, so the key never reaches a log.
      const keyed = this.keyInUse();
      const target = keyed ? this.withKey(url) : url;

      let response: Response;
      try {
        response = await this.doFetch(target, {
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

      if (response.status === 404) return null;

      if (!response.ok) {
        lastError = new ScholarlyError(this.service, response.status, `HTTP ${response.status}`);
        const retryAfterMs = await retryAfterOf(response);
        // The key's day is spent (a 429 asking for longer than any request waits): the same
        // request goes again at once without the key, and so does every request until the reset.
        // Not an attempt — nothing was tried that could be tried again.
        if (keyed && response.status === 429 && retryAfterMs > MAX_RETRY_AFTER_MS) {
          this.keySpentUntil = Date.now() + retryAfterMs;
          attempt -= 1;
          continue;
        }
        if (attempt < this.attempts && retryable(response.status)) {
          const waitMs = retryAfterMs > 0 ? retryAfterMs : 2 ** (attempt - 1) * 500;
          // ADR-0050: a service that says "come back in an hour" (OpenAlex when the day's budget
          // is spent answers 429 with the seconds to midnight UTC) is a failure now, not a wait:
          // honouring it left a literature search on "Searching…" for as long as it asked.
          if (waitMs > MAX_RETRY_AFTER_MS) throw lastError;
          await this.pause(waitMs, signal);
          continue;
        }
        throw lastError;
      }

      return response;
    }

    throw lastError ?? new ScholarlyError(this.service, null, 'exhausted retries');
  }
}

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
