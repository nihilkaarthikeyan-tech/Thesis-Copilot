/**
 * Import from Zotero by API key — ADR-0062 (ADR-0059 row 36), FR-2.9 by another transport.
 *
 * The student pastes their Zotero user ID and a read-only key; this reads their items once and
 * turns each into the same `BibEntry` the .bib/.ris import produces, so they go down the same
 * resolve pipeline. Nothing is linked or synced afterwards, and the key is used for these
 * requests only: it is sent in the `Zotero-API-Key` header (never the URL), it is never put in an
 * error message, and no error carries the underlying fetch failure as its `cause`.
 *
 * ## What was checked, and where (CLAUDE.md: check a third-party API's field list first)
 *
 * From the Zotero Web API v3 documentation (zotero.org/support/dev/web_api/v3/basics, read
 * 2026-10-04):
 *   - `Zotero-API-Key: <key>` and `Zotero-API-Version: 3` headers.
 *   - `/users/<userID>/items/top` and `/users/<userID>/collections/<collectionKey>/items/top`:
 *     "Top-level items … excluding trashed items", so child notes and attachments are not listed.
 *   - `itemType=-attachment` (NOT), from the documented Boolean search syntax.
 *   - `format=json` (default) returns an array of objects; `include=data,csljson` — `csljson` is
 *     listed among the export formats usable as `format`, `include` and `content`.
 *   - `limit` is 1–100 per request; `start` is the index of the first result; `Total-Results`
 *     carries the total; the `Link` header carries `rel="next"`.
 *   - 403 for authentication errors ("invalid API key or insufficient privileges"), 404, 429 for
 *     rate limiting, 500/503 for server faults.
 *
 * From the Zotero dataserver source (github.com/zotero/dataserver, `model/Item.inc.php` and
 * `model/Collection.inc.php`, read 2026-10-04):
 *   - with `include=csljson`, each item object carries the CSL item as `$json['csljson']`, and
 *     with `include=data` its editable fields as `data` (so `data.itemType` is there to skip notes,
 *     standalone attachments and annotations exactly);
 *   - a collection object is `{ key, version, library, links, meta: { numCollections, numItems },
 *     data: { key, version, name, parentCollection (a key or false), relations } }`.
 *
 * The CSL fields read (`type`, `title`, `author`, `editor`, `issued`, `container-title`,
 * `publisher`, `DOI`) are the CSL-JSON schema's own.
 */

import { type BibEntry, cleanDoi, rawLine } from './bibliography.js';
import type { FetchLike } from './http.js';

export const ZOTERO_API = 'https://api.zotero.org';

/** Where a student makes a key. */
export const ZOTERO_KEYS_URL = 'https://www.zotero.org/settings/keys';

/**
 * The most items one import reads. A library larger than this is refused before anything is
 * added, with the count, so the student can pick a collection instead of getting an arbitrary
 * first five hundred.
 */
export const ZOTERO_IMPORT_CAP = 500;

/** Zotero's own ceiling on one page. */
const PAGE_SIZE = 100;

/** Most collections read for the dropdown; more than this is a library nobody scrolls. */
const COLLECTIONS_CAP = 500;

/** Item types that are not references. */
const NOT_REFERENCES = new Set(['note', 'attachment', 'annotation']);

export type ZoteroFailure =
  /** 403: a wrong key, a key without library access, or a user ID the key does not belong to. */
  | 'BAD_KEY'
  /** 404: no such user or collection. */
  | 'NOT_FOUND'
  /** 429, or a 503 with `Retry-After`. */
  | 'RATE_LIMITED'
  /** Any other non-2xx answer, or a body that is not what the documentation describes. */
  | 'UNAVAILABLE'
  /** No answer at all: DNS, connection, timeout. */
  | 'NETWORK'
  /** More items than `ZOTERO_IMPORT_CAP`. */
  | 'TOO_MANY';

/**
 * A failure talking to Zotero, with a message fit to show the student.
 *
 * Deliberately has no `cause`: an undici error can carry the request, and the request carries the
 * key in a header. The message is built here from the status alone.
 */
export class ZoteroError extends Error {
  constructor(
    readonly failure: ZoteroFailure,
    message: string,
    /** For `TOO_MANY`: how many items Zotero says there are. */
    readonly total: number | null = null,
  ) {
    super(message);
    this.name = 'ZoteroError';
  }
}

export type ZoteroCredentials = {
  /** The numeric user ID shown on the keys page ("Your userID for use in API calls is …"). */
  userId: string;
  apiKey: string;
};

export type ZoteroOptions = {
  fetch?: FetchLike;
  /** Per request; a hung Zotero must not hold the API's request open. */
  timeoutMs?: number;
};

export type ZoteroCollection = {
  key: string;
  name: string;
  /** The parent collection's key, or null at the top level. */
  parentKey: string | null;
  /** `meta.numItems`, when Zotero sent it. */
  numItems: number | null;
};

export type ZoteroItems = {
  /** References with a title or a DOI, ready for the resolve pipeline. */
  entries: BibEntry[];
  /** Top-level items Zotero reported (attachments already excluded by the query). */
  total: number;
  /** Notes, standalone attachments and annotations that were left out. */
  notReferences: number;
  /** References with neither a title nor a DOI: nothing to look them up by. */
  skipped: number;
};

/** Strips anything that looks like the key from a string, for the rare message that echoes. */
export function redactKey(text: string, apiKey: string): string {
  return apiKey ? text.split(apiKey).join('[redacted]') : text;
}

function failureFor(status: number): ZoteroError {
  if (status === 403) {
    return new ZoteroError(
      'BAD_KEY',
      'Zotero refused that key. Check the user ID (the number on the keys page, not your username) and that the key is allowed to read your library.',
    );
  }
  if (status === 404) {
    return new ZoteroError(
      'NOT_FOUND',
      'Zotero has no library or collection under that ID. Check the user ID on the keys page.',
    );
  }
  if (status === 429) {
    return new ZoteroError(
      'RATE_LIMITED',
      'Zotero asked us to slow down. Wait a minute and try the import again.',
    );
  }
  return new ZoteroError(
    'UNAVAILABLE',
    `Zotero did not answer properly (status ${status}). Try again in a few minutes, or export a .bib file from Zotero instead.`,
  );
}

const networkFailure = () =>
  new ZoteroError(
    'NETWORK',
    'Could not reach Zotero. Check your connection and try again, or export a .bib file from Zotero instead.',
  );

const malformed = () =>
  new ZoteroError(
    'UNAVAILABLE',
    'Zotero sent something we could not read. Try again, or export a .bib file from Zotero instead.',
  );

async function get(url: string, credentials: ZoteroCredentials, options: ZoteroOptions) {
  // Late-bound: the global is looked up per call, so a test's spy on it is the one used.
  const doFetch: FetchLike = options.fetch ?? ((u, init) => fetch(u, init));
  let response: Response;
  try {
    response = await doFetch(url, {
      headers: {
        'Zotero-API-Key': credentials.apiKey,
        'Zotero-API-Version': '3',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
    });
  } catch {
    // The error itself is dropped on purpose; see `ZoteroError`.
    throw networkFailure();
  }
  if (response.status === 503 && response.headers.get('retry-after')) {
    throw failureFor(429);
  }
  if (!response.ok) throw failureFor(response.status);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw malformed();
  }
  return { body, headers: response.headers };
}

/** The `rel="next"` URL from a `Link` header, only if it stays on the Zotero API. */
export function nextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(',')) {
    const match = /<([^>]+)>\s*;\s*rel="?next"?/.exec(part.trim());
    if (!match?.[1]) continue;
    try {
      const url = new URL(match[1]);
      // The key goes with every request, so a next page anywhere else is not followed.
      return url.origin === ZOTERO_API ? url.toString() : null;
    } catch {
      return null;
    }
  }
  return null;
}

function totalOf(headers: Headers): number | null {
  const value = Number(headers.get('total-results'));
  return Number.isFinite(value) && headers.get('total-results') !== null ? value : null;
}

function userBase(credentials: ZoteroCredentials): string {
  return `${ZOTERO_API}/users/${encodeURIComponent(credentials.userId)}`;
}

/** Every collection in the library, for "which collection?" — also how a key is checked. */
export async function listZoteroCollections(
  credentials: ZoteroCredentials,
  options: ZoteroOptions = {},
): Promise<ZoteroCollection[]> {
  const collections: ZoteroCollection[] = [];
  let url: string | null =
    `${userBase(credentials)}/collections?format=json&limit=${PAGE_SIZE}&start=0`;
  let start = 0;
  while (url && collections.length < COLLECTIONS_CAP) {
    const { body, headers } = await get(url, credentials, options);
    if (!Array.isArray(body)) throw malformed();
    for (const raw of body as Array<Record<string, unknown>>) {
      const data = (raw.data ?? {}) as Record<string, unknown>;
      const meta = (raw.meta ?? {}) as Record<string, unknown>;
      const key =
        typeof raw.key === 'string' ? raw.key : typeof data.key === 'string' ? data.key : null;
      const name = typeof data.name === 'string' ? data.name.trim() : '';
      if (!key || !name) continue;
      collections.push({
        key,
        name,
        parentKey: typeof data.parentCollection === 'string' ? data.parentCollection : null,
        numItems: typeof meta.numItems === 'number' ? meta.numItems : null,
      });
    }
    start += PAGE_SIZE;
    const total = totalOf(headers);
    url =
      nextLink(headers.get('link')) ??
      (headers.get('link') === null && total !== null && start < total && body.length > 0
        ? `${userBase(credentials)}/collections?format=json&limit=${PAGE_SIZE}&start=${start}`
        : null);
  }
  return collections.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Reads the library's top-level items (or one collection's) and maps each reference to a
 * `BibEntry`. Refuses with `TOO_MANY` before mapping anything when Zotero reports more than
 * `cap` items, so an import is never silently cut short.
 */
export async function readZoteroItems(
  credentials: ZoteroCredentials,
  options: ZoteroOptions & { collectionKey?: string | null; cap?: number } = {},
): Promise<ZoteroItems> {
  const cap = options.cap ?? ZOTERO_IMPORT_CAP;
  const path = options.collectionKey
    ? `/collections/${encodeURIComponent(options.collectionKey)}/items/top`
    : '/items/top';
  const pageUrl = (start: number) =>
    `${userBase(credentials)}${path}?format=json&include=data,csljson&itemType=-attachment&limit=${PAGE_SIZE}&start=${start}`;

  const entries: BibEntry[] = [];
  let total: number | null = null;
  let seen = 0;
  let notReferences = 0;
  let skipped = 0;
  let start = 0;
  let url: string | null = pageUrl(0);
  // One more page than the cap needs, as a guard against a server that never stops paging.
  const maxPages = Math.ceil(cap / PAGE_SIZE) + 1;

  for (let page = 0; url && page < maxPages; page++) {
    const { body, headers } = await get(url, credentials, options);
    if (!Array.isArray(body)) throw malformed();
    if (total === null) {
      total = totalOf(headers);
      if (total !== null && total > cap) {
        throw new ZoteroError(
          'TOO_MANY',
          `That ${options.collectionKey ? 'collection' : 'library'} has ${total} items, and one import takes up to ${cap}. Pick a collection, or import it in parts.`,
          total,
        );
      }
    }
    for (const raw of body as Array<Record<string, unknown>>) {
      seen++;
      const data = (raw.data ?? {}) as Record<string, unknown>;
      const itemType = typeof data.itemType === 'string' ? data.itemType : null;
      if (itemType && NOT_REFERENCES.has(itemType)) {
        notReferences++;
        continue;
      }
      const csl = raw.csljson;
      const entry =
        csl && typeof csl === 'object'
          ? cslToBibEntry(csl as CslItem, {
              key: typeof raw.key === 'string' ? raw.key : null,
              extra: typeof data.extra === 'string' ? data.extra : null,
            })
          : null;
      if (entry) entries.push(entry);
      else skipped++;
    }
    if (seen > cap) {
      // Total-Results was missing or wrong; refuse rather than import a truncated library.
      throw new ZoteroError(
        'TOO_MANY',
        `That ${options.collectionKey ? 'collection' : 'library'} has more than ${cap} items, and one import takes up to ${cap}. Pick a collection, or import it in parts.`,
        seen,
      );
    }
    start += PAGE_SIZE;
    const link = headers.get('link');
    url =
      nextLink(link) ??
      (link === null && total !== null && start < total && body.length > 0 ? pageUrl(start) : null);
  }
  return { entries, total: total ?? seen, notReferences, skipped };
}

// ---------------------------------------------------------------------------------------------
// CSL-JSON → BibEntry
// ---------------------------------------------------------------------------------------------

type CslName = { family?: unknown; given?: unknown; literal?: unknown };

export type CslItem = {
  type?: unknown;
  title?: unknown;
  author?: unknown;
  editor?: unknown;
  issued?: unknown;
  'container-title'?: unknown;
  publisher?: unknown;
  DOI?: unknown;
};

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.replace(/\s+/g, ' ').trim() : null;

function names(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return (value as CslName[])
    .map((n) => {
      const literal = text(n?.literal);
      if (literal) return literal;
      const family = text(n?.family);
      const given = text(n?.given);
      if (family && given) return `${family}, ${given}`;
      return family ?? given;
    })
    .filter((n): n is string => Boolean(n));
}

function yearOf(issued: unknown): number | null {
  if (!issued || typeof issued !== 'object') return null;
  const parts = (issued as { 'date-parts'?: unknown })['date-parts'];
  if (Array.isArray(parts) && Array.isArray(parts[0])) {
    const year = Number(parts[0][0]);
    if (Number.isInteger(year) && year > 0) return year;
  }
  const raw =
    text((issued as { raw?: unknown }).raw) ?? text((issued as { literal?: unknown }).literal);
  const match = raw ? /\b(\d{4})\b/.exec(raw) : null;
  return match ? Number(match[1]) : null;
}

/** Zotero keeps a DOI for item types without a DOI field as a `DOI: …` line in Extra. */
function doiFromExtra(extra: string | null): string | null {
  if (!extra) return null;
  const match = /^\s*DOI:\s*(\S+)\s*$/im.exec(extra);
  return cleanDoi(match?.[1] ?? null);
}

/** One CSL-JSON item as a `BibEntry`; null when it has neither a title nor a DOI. */
export function cslToBibEntry(
  csl: CslItem,
  extras: { key?: string | null; extra?: string | null } = {},
): BibEntry | null {
  const authors = names(csl.author);
  const partial = {
    key: extras.key ?? null,
    type: text(csl.type) ?? 'misc',
    title: text(csl.title),
    authors: authors.length ? authors : names(csl.editor),
    year: yearOf(csl.issued),
    venue: text(csl['container-title']) ?? text(csl.publisher),
    doi: cleanDoi(text(csl.DOI)) ?? doiFromExtra(extras.extra ?? null),
  };
  if (!partial.title && !partial.doi) return null;
  return { ...partial, raw: rawLine(partial) };
}
