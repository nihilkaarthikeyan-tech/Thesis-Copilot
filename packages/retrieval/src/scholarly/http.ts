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
  private readonly limiter: RateLimiter;
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
    this.limiter = new RateLimiter(
      options.requestsPerSecond ?? DEFAULT_REQUESTS_PER_SECOND,
      this.sleep,
    );
    // Crossref and OpenAlex both ask for a contact address in the User-Agent for the polite pool.
    this.userAgent = options.userAgent ?? `ThesisCopilot/0.1 (mailto:${options.mailto})`;
  }

  /** GETs JSON with polite rate limiting and exponential backoff. Returns null on 404. */
  async getJson<T>(url: string, signal?: AbortSignal): Promise<T | null> {
    let lastError: ScholarlyError | null = null;

    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      await this.limiter.acquire();
      if (signal?.aborted) throw new ScholarlyError(this.service, null, 'aborted');

      let response: Response;
      try {
        response = await this.doFetch(url, {
          headers: { accept: 'application/json', 'user-agent': this.userAgent },
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

      return (await response.json()) as T;
    }

    throw lastError ?? new ScholarlyError(this.service, null, 'exhausted retries');
  }
}
