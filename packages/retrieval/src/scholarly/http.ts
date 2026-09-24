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

  constructor(
    private readonly service: string,
    options: ScholarlyClientOptions,
  ) {
    this.mailto = options.mailto;
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

  private async get(url: string, accept: string, signal?: AbortSignal): Promise<Response | null> {
    let lastError: ScholarlyError | null = null;

    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      await this.acquire();
      if (signal?.aborted) throw new ScholarlyError(this.service, null, 'aborted');

      let response: Response;
      try {
        response = await this.doFetch(url, {
          headers: { accept, 'user-agent': this.userAgent },
          ...(signal ? { signal } : {}),
        });
      } catch (cause) {
        lastError = new ScholarlyError(
          this.service,
          null,
          cause instanceof Error ? cause.message : String(cause),
        );
        if (attempt < this.attempts) await this.sleep(2 ** (attempt - 1) * 500);
        continue;
      }

      if (response.status === 404) return null;

      if (!response.ok) {
        lastError = new ScholarlyError(this.service, response.status, `HTTP ${response.status}`);
        if (attempt < this.attempts && retryable(response.status)) {
          const retryAfter = Number(response.headers.get('retry-after'));
          await this.sleep(
            Number.isFinite(retryAfter) && retryAfter > 0
              ? retryAfter * 1000
              : 2 ** (attempt - 1) * 500,
          );
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
