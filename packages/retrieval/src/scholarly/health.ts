/**
 * What each scholarly index is doing to us right now — ADR-0149 (2026-10-10).
 *
 * Measured on production: OpenAlex answered every keyed request with HTTP 429 and a body saying
 * the key's free daily budget was spent ("you only have $0 remaining. Resets at midnight UTC"),
 * while the same query without the key answered 200 from the polite pool. Every client kept
 * sending the key, every search returned nothing, and nothing in the product said so.
 *
 * This is the one place that remembers two facts per index, so every client in the process (and
 * every process, through Redis when a store is attached) acts on them without asking again:
 *
 * - the keyed budget is spent until a time: requests go without the key until then;
 * - the index is refusing requests until a time: nothing is sent before it.
 *
 * It also keeps when the refusals began, so the admin alert can say "refusing for 20 minutes".
 * One log line per state change, never per call.
 */

export type IndexState = {
  service: string;
  /** The key's daily budget is spent until this time (ms); requests go keyless until then. */
  keyedExhaustedUntil: number | null;
  /** The index is refusing requests until this time (ms); nothing is sent before it. */
  refusedUntil: number | null;
  /** When the current run of refusals began; null while the index answers. */
  refusingSince: number | null;
  /** The last refusal, in the index's own words (trimmed; never a key). */
  reason: string | null;
};

/** The part of a Redis client this needs — ioredis's `GET` and `SET key value PX ms`. */
export type HealthStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, px: 'PX', ms: number): Promise<unknown>;
};

export type HealthLog = (event: Record<string, unknown>) => void;

export type IndexHealthOptions = {
  store?: HealthStore | null;
  /** Redis key prefix; keys are `${prefix}${service}`. */
  prefix?: string;
  /** How long an in-process copy is trusted before the store is read again. */
  refreshMs?: number;
  now?: () => number;
  log?: HealthLog;
};

/** A state survives in the store this long; every field in it carries its own time anyway. */
const STORE_TTL_MS = 36 * 60 * 60_000;

const blank = (service: string): IndexState => ({
  service,
  keyedExhaustedUntil: null,
  refusedUntil: null,
  refusingSince: null,
  reason: null,
});

export class IndexHealth {
  private readonly states = new Map<string, IndexState>();
  private readonly readAt = new Map<string, number>();
  private store: HealthStore | null;
  private prefix: string;
  private readonly refreshMs: number;
  private readonly now: () => number;
  private log: HealthLog;

  constructor(options: IndexHealthOptions = {}) {
    this.store = options.store ?? null;
    this.prefix = options.prefix ?? 'scholarly:health:';
    this.refreshMs = options.refreshMs ?? 30_000;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? (() => undefined);
  }

  /** Attaches the shared store and the app's logger — once, at boot, on the shared instance. */
  configure(options: { store?: HealthStore | null; prefix?: string; log?: HealthLog }): void {
    if (options.store !== undefined) this.store = options.store;
    if (options.prefix !== undefined) this.prefix = options.prefix;
    if (options.log) this.log = options.log;
    this.readAt.clear();
  }

  /** The state as this process knows it, refreshed from the store when the copy is stale. */
  async state(service: string): Promise<IndexState> {
    const now = this.now();
    if (
      this.store &&
      now - (this.readAt.get(service) ?? Number.NEGATIVE_INFINITY) > this.refreshMs
    ) {
      this.readAt.set(service, now);
      try {
        const raw = await this.store.get(this.prefix + service);
        if (raw) {
          const stored = JSON.parse(raw) as Partial<IndexState>;
          this.states.set(service, { ...blank(service), ...stored, service });
        }
      } catch {
        // The store is a convenience between processes; this process's own copy still holds.
      }
    }
    return this.states.get(service) ?? blank(service);
  }

  /** Whether requests should carry the key: not while its budget is known to be spent. */
  async keyUsable(service: string): Promise<boolean> {
    const state = await this.state(service);
    return !(state.keyedExhaustedUntil !== null && state.keyedExhaustedUntil > this.now());
  }

  /** The time until which the index is refusing, or null when a request may be sent. */
  async refusedUntil(service: string): Promise<number | null> {
    const state = await this.state(service);
    return state.refusedUntil !== null && state.refusedUntil > this.now()
      ? state.refusedUntil
      : null;
  }

  /** The keyed budget is spent: go keyless until `until`. Logged once per exhaustion. */
  async markKeyedExhausted(service: string, until: number, reason: string): Promise<void> {
    const state = await this.state(service);
    if (state.keyedExhaustedUntil !== null && state.keyedExhaustedUntil >= until) return;
    await this.write({ ...state, keyedExhaustedUntil: until, reason: trim(reason) });
    this.log({
      level: 40,
      msg: 'scholarly index: keyed budget spent, requests go without the key',
      index: service,
      until: new Date(until).toISOString(),
      reason: trim(reason),
    });
  }

  /** The index refused (429) and nothing should be sent before `until`. */
  async markRefused(service: string, until: number, reason: string): Promise<void> {
    const state = await this.state(service);
    const now = this.now();
    const next: IndexState = {
      ...state,
      refusedUntil: Math.max(until, state.refusedUntil ?? 0),
      refusingSince: state.refusingSince ?? now,
      reason: trim(reason),
    };
    const change = state.refusingSince === null ? 'began' : 'continues';
    await this.write(next);
    // A refusal that merely extends the same run is not news; the first one is.
    if (change === 'began' || (state.refusedUntil ?? 0) < now) {
      this.log({
        level: 40,
        msg: `scholarly index: refusing requests (${change})`,
        index: service,
        until: new Date(next.refusedUntil ?? until).toISOString(),
        since: new Date(next.refusingSince ?? now).toISOString(),
        reason: trim(reason),
      });
    }
  }

  /** The index answered: the run of refusals, if any, is over. Cheap when there was none. */
  async markAnswered(service: string): Promise<void> {
    const state = this.states.get(service);
    if (!state || (state.refusedUntil === null && state.refusingSince === null)) return;
    await this.write({ ...state, refusedUntil: null, refusingSince: null });
    this.log({ msg: 'scholarly index: answering again', index: service });
  }

  /**
   * Every index this process has heard from, plus `services`, read fresh from the store — for
   * the admin overview and the §14 alert, which must see the worker's refusals too.
   */
  async snapshot(services: readonly string[] = []): Promise<IndexState[]> {
    const names = new Set([...services, ...this.states.keys()]);
    this.readAt.clear();
    const out: IndexState[] = [];
    for (const name of names) out.push(await this.state(name));
    return out;
  }

  private async write(state: IndexState): Promise<void> {
    this.states.set(state.service, state);
    this.readAt.set(state.service, this.now());
    if (!this.store) return;
    try {
      await this.store.set(this.prefix + state.service, JSON.stringify(state), 'PX', STORE_TTL_MS);
    } catch {
      // Same as above: the shared copy is best effort.
    }
  }
}

const trim = (reason: string): string => reason.replace(/\s+/g, ' ').trim().slice(0, 200);

/**
 * The one registry every client in a process shares. `WebScopeService` builds a new OpenAlex
 * client per request, so the memory cannot live on the client.
 */
export const scholarlyHealth = new IndexHealth();

/** The next 00:00 UTC after `now` — when OpenAlex's daily budgets reset. */
export function nextMidnightUtc(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

/** What a 429 said, read from the body and headers OpenAlex and Semantic Scholar use. */
export type RefusalInfo = {
  /** The index's own `Retry-After`, in ms, when it sent one. */
  retryAfterMs: number | null;
  /** OpenAlex: the caller's budget (keyed or anonymous) is spent for the day. */
  budgetSpent: boolean;
  message: string;
};

/**
 * Reads a 429 without consuming the caller's response. Recorded 2026-10-10 from OpenAlex:
 * `{"error":"Rate limit exceeded","message":"Insufficient budget… you only have $0 remaining.
 * Resets at midnight UTC…","dailyRemainingUsd":0,"prepaidRemainingUsd":0,"creditsRequired":10}`
 * with `x-ratelimit-remaining-usd: 0` and `retry-after` set to the seconds to midnight UTC.
 * Semantic Scholar without a key: `{"message": "Too Many Requests. Please wait and try again or
 * apply for a key…", "code": "429"}` and no `Retry-After`.
 */
export async function readRefusal(response: Response): Promise<RefusalInfo> {
  const retryAfter = Number(response.headers.get('retry-after'));
  const retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : null;
  let body: {
    message?: unknown;
    error?: unknown;
    dailyRemainingUsd?: unknown;
    prepaidRemainingUsd?: unknown;
  } = {};
  try {
    body = (await response.clone().json()) as typeof body;
  } catch {
    // Not JSON, or already read; the headers still say what they say.
  }
  const message = [body.error, body.message]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(': ');
  const remainingUsd = response.headers.get('x-ratelimit-remaining-usd');
  // The wording has varied ("Insufficient budget", "Insufficient credits"); the numbers decide
  // first, and a prepaid balance left over means the key still answers.
  const prepaidLeft = typeof body.prepaidRemainingUsd === 'number' && body.prepaidRemainingUsd > 0;
  const budgetSpent =
    remainingUsd === '0' ||
    (body.dailyRemainingUsd === 0 && !prepaidLeft) ||
    /insufficient (budget|credits)|\$0 remaining/i.test(message);
  return { retryAfterMs, budgetSpent, message: message || `HTTP ${response.status}` };
}
