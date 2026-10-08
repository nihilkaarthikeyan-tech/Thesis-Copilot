/**
 * Rewriting the ids inside a thesis's JSON when it is copied (ADR-0057).
 *
 * A chapter's ProseMirror document names sources (`citation.attrs.sourceId`), chunks
 * (`citation.attrs.chunkId`) and figure storage keys (`image.attrs.key`, which carry the document
 * and chapter ids); the memory's gap map lists source ids; the proposal meta may name chapters.
 * A copy must point at its own rows, never the original's — otherwise deleting the original
 * would silently break the copy's citations and pictures.
 *
 * Every id is a UUID, unique across the database, so a string that *is* an old id can only mean
 * that row, and the rewrite can be done without knowing the schema of every JSON field: exact
 * matches are replaced, and a storage key (a path made of ids) has each id segment replaced.
 * Free text is never touched — a sentence that happens to contain an id is not an exact match
 * and is not a storage key.
 */

const STORAGE_PREFIXES = ['figures/', 'sources/', 'seed-papers/'];

export type IdMap = ReadonlyMap<string, string>;

/** A storage key with each `/`-separated id segment (or `id.ext`) mapped; others unchanged. */
export function remapKey(key: string, ids: IdMap): string {
  return key
    .split('/')
    .map((segment) => {
      const dot = segment.indexOf('.');
      const stem = dot === -1 ? segment : segment.slice(0, dot);
      const mapped = ids.get(stem);
      return mapped ? mapped + (dot === -1 ? '' : segment.slice(dot)) : segment;
    })
    .join('/');
}

function remapString(value: string, ids: IdMap): string {
  const exact = ids.get(value);
  if (exact) return exact;
  if (STORAGE_PREFIXES.some((prefix) => value.startsWith(prefix))) return remapKey(value, ids);
  return value;
}

/** A deep copy of `value` with every id string mapped. Objects and arrays are rebuilt, not shared. */
export function remapIds<T>(value: T, ids: IdMap): T {
  if (typeof value === 'string') return remapString(value, ids) as T;
  if (Array.isArray(value)) return value.map((item) => remapIds(item, ids)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = remapIds(child, ids);
    }
    return out as T;
  }
  return value;
}

const COPY_SUFFIX = ' (copy)';

/**
 * `<title> (copy)` (R29, ADR-0114; it was `Copy of …`), kept inside the title limit the create
 * route enforces. A title too long for the suffix is shortened before it, so the copy still says
 * what it is: the list sorts and reads by the start of a title, and the end is what marks a copy.
 */
export function copyTitle(title: string, max = 300): string {
  const titled = `${title}${COPY_SUFFIX}`;
  if (titled.length <= max) return titled;
  return `${title.slice(0, max - COPY_SUFFIX.length - 1)}…${COPY_SUFFIX}`;
}
