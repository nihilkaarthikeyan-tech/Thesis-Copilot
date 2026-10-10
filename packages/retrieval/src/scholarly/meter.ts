/**
 * What OpenAlex charges us per day — ADR-0149 (2026-10-10).
 *
 * OpenAlex meters its API by cost (pricing page, 2026): a `search` request is $1 per 1,000
 * ($0.001 each, "10 credits"), a list or filter request $0.10 per 1,000, and a single-record
 * lookup (`/works/W…`, `/works/doi:…`) is free. A key carries a free $1 a day; without one the
 * whole site shares $0.10 a day — about a hundred searches, a buffer and not a plan.
 *
 * This counts what we send, per UTC day, in Redis when a store is attached (the API and the
 * worker both search, and a restart must not reset the day), so the admin can see the day's use
 * and is warned at 70% and 90% of the keyed budget before the index starts refusing. The count is
 * ours, not OpenAlex's bill: a refused request is not counted, and the classification is by URL.
 */

export type OpenAlexRequestKind = 'search' | 'list' | 'lookup';

/** USD per request, from the pricing page (2026-10-10). */
export const OPENALEX_USD = {
  search: 0.001,
  list: 0.0001,
  lookup: 0,
  /** The free daily budget a key carries. */
  keyedDailyBudget: 1,
  /** The free daily budget the polite pool shares, site-wide. */
  keylessDailyBudget: 0.1,
} as const;

/** The fractions of the keyed budget at which the admin is told (ADR-0149). */
export const OPENALEX_WARN_SHARES = [0.7, 0.9] as const;

/**
 * Which price an OpenAlex URL pays. `search=`, `search.semantic=` and any `.search:` filter are
 * searches; a list of records by filter is a list; one record by id is free.
 */
export function classifyOpenAlexRequest(url: string): OpenAlexRequestKind {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'list';
  }
  // One record by id: `/works/W123`, `/works/doi:10.1038/x` (a DOI carries its own slashes).
  if (/^\/(works|sources|authors|institutions|topics)\/.+$/.test(parsed.pathname)) {
    return 'lookup';
  }
  for (const [name, value] of parsed.searchParams) {
    if (name === 'search' || name.startsWith('search.')) return 'search';
    if (name === 'filter' && /(^|,)[a-z_.]*\.search:/.test(value)) return 'search';
  }
  return 'list';
}

/** The part of a Redis client the meter needs — ioredis's hash commands. */
export type MeterStore = {
  hincrby(key: string, field: string, increment: number): Promise<number>;
  hgetall(key: string): Promise<Record<string, string>>;
  pexpire(key: string, ms: number): Promise<unknown>;
};

export type OpenAlexDay = {
  /** `YYYY-MM-DD`, UTC. */
  date: string;
  searches: number;
  lists: number;
  lookups: number;
  /** Requests sent with the key; the rest went to the polite pool. */
  keyed: number;
  /** Our estimate of the day's cost, by the prices above. */
  usd: number;
  /** `usd` against the keyed free budget. */
  shareOfKeyedBudget: number;
};

const DAY_TTL_MS = 48 * 60 * 60_000;

export const utcDay = (now: number): string => new Date(now).toISOString().slice(0, 10);

export class OpenAlexMeter {
  private store: MeterStore | null;
  private prefix: string;
  private readonly now: () => number;
  /** This process's own counts, the whole record when no store is attached. */
  private readonly local = new Map<string, Record<string, number>>();

  constructor(options: { store?: MeterStore | null; prefix?: string; now?: () => number } = {}) {
    this.store = options.store ?? null;
    this.prefix = options.prefix ?? 'scholarly:openalex:day:';
    this.now = options.now ?? Date.now;
  }

  configure(options: { store?: MeterStore | null; prefix?: string }): void {
    if (options.store !== undefined) this.store = options.store;
    if (options.prefix !== undefined) this.prefix = options.prefix;
  }

  /** One request sent (and answered with something other than a refusal). Never throws. */
  async record(url: string, keyed: boolean): Promise<void> {
    const kind = classifyOpenAlexRequest(url);
    const key = this.prefix + utcDay(this.now());
    const counts = this.local.get(key) ?? {};
    counts[kind] = (counts[kind] ?? 0) + 1;
    if (keyed) counts.keyed = (counts.keyed ?? 0) + 1;
    this.local.set(key, counts);
    if (!this.store) return;
    try {
      await this.store.hincrby(key, kind, 1);
      if (keyed) await this.store.hincrby(key, 'keyed', 1);
      await this.store.pexpire(key, DAY_TTL_MS);
    } catch {
      // The count is advisory; a request never fails on it.
    }
  }

  /** Today's use, from the store when there is one (every process's requests), else this one's. */
  async today(now: number = this.now()): Promise<OpenAlexDay> {
    const date = utcDay(now);
    const key = this.prefix + date;
    let counts: Record<string, number> = this.local.get(key) ?? {};
    if (this.store) {
      try {
        const raw = await this.store.hgetall(key);
        counts = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Number(v) || 0]));
      } catch {
        // Fall back to what this process has seen.
      }
    }
    const searches = counts.search ?? 0;
    const lists = counts.list ?? 0;
    const lookups = counts.lookup ?? 0;
    const usd = searches * OPENALEX_USD.search + lists * OPENALEX_USD.list;
    return {
      date,
      searches,
      lists,
      lookups,
      keyed: counts.keyed ?? 0,
      usd: Math.round(usd * 1e6) / 1e6,
      shareOfKeyedBudget: usd / OPENALEX_USD.keyedDailyBudget,
    };
  }
}

/** The one meter every OpenAlex client in a process reports to. */
export const openAlexMeter = new OpenAlexMeter();
