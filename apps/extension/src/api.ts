/**
 * The add-on's calls to Thesis Copilot — ADR-0031, ADR-0069. Every one goes to the one host the
 * add-on has permission for, with the student's own session cookie (`credentials: 'include'`):
 * the add-on holds no token and no password of its own.
 *
 * `fetchPdf` is the one request to anywhere else — the PDF in the student's own tab, which they
 * asked for by saving it.
 */

import type { Collection, Preview, Reply, Thesis } from './messages.js';
import { cleanDoi, clip, shortByline } from './paper.js';

/** What the library list gives back that the add-on uses. */
export type LibraryRow = { id: string; doi: string | null; hasFile: boolean };

/** The most the add-on will download for one PDF. The site's own limit per plan is lower. */
export const PDF_MAX_BYTES = 50 * 1024 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Ids go into a path; anything that is not a UUID never reaches one. */
export const isId = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value);

const UNREACHABLE = 'Thesis Copilot could not be reached. Check your connection and try again.';
const TOO_SLOW = 'Thesis Copilot took too long to answer. Try again in a moment.';

/**
 * Time limits for the in-page card's two calls (ADR-0125). The server gives each outside lookup
 * 15 s (ADR-0103); a card must never wait for ever on "Saving…", as Jenni's did on "Processing
 * PDF…".
 */
export const LOOKUP_TIMEOUT_MS = 25_000;
export const IMPORT_TIMEOUT_MS = 45_000;

/** A name from the lookup's CSL author: "Asha Kumar", or the group's literal name. */
function authorName(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const { family, given, literal } = value as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === 'string' ? v : '');
  return clip(text(literal) || `${text(given)} ${text(family)}`, 120);
}

/** `lookup-id`'s answer as the card keeps it; anything that does not check out is dropped. */
export function previewFrom(value: unknown): Preview | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const kind = v.kind === 'doi' || v.kind === 'arxiv' || v.kind === 'pmid' ? v.kind : null;
  const title = typeof v.title === 'string' ? clip(v.title, 500) : '';
  if (!kind || !title) return null;
  const authors = Array.isArray(v.authors) ? v.authors.slice(0, 50).map(authorName) : [];
  const count = v.citedBy;
  return {
    kind,
    title,
    byline: shortByline(authors.filter(Boolean)),
    year: typeof v.year === 'number' && Number.isInteger(v.year) ? v.year : null,
    venue: typeof v.venue === 'string' && v.venue.trim() ? clip(v.venue, 200) : null,
    doi: typeof v.doi === 'string' ? cleanDoi(v.doi) : null,
    citedBy:
      typeof count === 'number' && Number.isInteger(count) && count >= 0 && count < 1e9
        ? count
        : null,
    openAccessVia:
      v.openAccessVia === 'arXiv' || v.openAccessVia === 'PubMed Central' ? v.openAccessVia : null,
  };
}

export type Api = ReturnType<typeof makeApi>;

export function makeApi(base: string, fetcher: typeof fetch = fetch) {
  async function call<T>(
    path: string,
    init: RequestInit = {},
    timeoutMs?: number,
  ): Promise<Reply<T>> {
    let response: Response;
    try {
      const json = typeof init.body === 'string';
      response = await fetcher(`${base}/api/v1${path}`, {
        ...init,
        credentials: 'include',
        headers: {
          accept: 'application/json',
          ...(json ? { 'content-type': 'application/json' } : {}),
        },
        ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
      });
    } catch (error) {
      const late = (error as { name?: unknown } | null)?.name === 'TimeoutError';
      return { ok: false, status: 0, message: late ? TOO_SLOW : UNREACHABLE };
    }
    if (!response.ok) {
      let message = `Thesis Copilot answered ${response.status}.`;
      if (response.status === 401) message = 'You are signed out of Thesis Copilot.';
      else {
        try {
          // RFC 9457 problem details, as every error from the API is.
          const problem = (await response.json()) as { detail?: unknown; title?: unknown };
          const text = typeof problem.detail === 'string' ? problem.detail : problem.title;
          if (typeof text === 'string' && text.trim()) message = text.slice(0, 300);
        } catch {
          // Not JSON; the status says enough.
        }
      }
      return { ok: false, status: response.status, message };
    }
    try {
      return { ok: true, value: (await response.json()) as T };
    } catch {
      return {
        ok: false,
        status: response.status,
        message: 'Thesis Copilot sent an answer the add-on could not read.',
      };
    }
  }

  const post = <T>(path: string, body: unknown) =>
    call<T>(path, { method: 'POST', body: JSON.stringify(body) });

  const guard = <T>(id: string, run: () => Promise<Reply<T>>): Promise<Reply<T>> =>
    isId(id)
      ? run()
      : Promise.resolve({
          ok: false,
          status: 400,
          message: 'That thesis is not one the add-on knows.',
        });

  return {
    async theses(): Promise<Reply<Thesis[]>> {
      const reply = await call<Array<{ id: unknown; title: unknown }>>('/documents');
      if (!reply.ok) return reply;
      if (!Array.isArray(reply.value)) return { ok: true, value: [] };
      return {
        ok: true,
        value: reply.value
          .filter((d) => isId(d.id))
          .map((d) => ({
            id: d.id as string,
            title: typeof d.title === 'string' ? d.title.slice(0, 300) : '',
          })),
      };
    },

    collections(documentId: string): Promise<Reply<Collection[]>> {
      return guard(documentId, async () => {
        const reply = await call<Array<{ id: unknown; name: unknown; count: unknown }>>(
          `/documents/${documentId}/collections`,
        );
        if (!reply.ok) return reply;
        return {
          ok: true,
          value: (Array.isArray(reply.value) ? reply.value : [])
            .filter((c) => isId(c.id) && typeof c.name === 'string')
            .map((c) => ({
              id: c.id as string,
              name: (c.name as string).slice(0, 200),
              count: typeof c.count === 'number' ? c.count : 0,
            })),
        };
      });
    },

    createCollection(documentId: string, name: string): Promise<Reply<Collection>> {
      return guard(documentId, () =>
        post<Collection>(`/documents/${documentId}/collections`, {
          name: name.trim().slice(0, 60),
        }),
      );
    },

    library(documentId: string): Promise<Reply<LibraryRow[]>> {
      return guard(documentId, async () => {
        const reply = await call<Array<{ id: unknown; doi: unknown; hasFile: unknown }>>(
          `/documents/${documentId}/sources`,
        );
        if (!reply.ok) return reply;
        return {
          ok: true,
          value: (Array.isArray(reply.value) ? reply.value : [])
            .filter((s) => isId(s.id))
            .map((s) => ({
              id: s.id as string,
              doi: typeof s.doi === 'string' ? s.doi : null,
              hasFile: s.hasFile === true,
            })),
        };
      });
    },

    resolve(
      documentId: string,
      references: Array<{ raw: string; doi?: string }>,
    ): Promise<Reply<{ sourceIds: Array<string | null> }>> {
      return guard(documentId, async () => {
        const reply = await post<{ sourceIds?: unknown }>(
          `/documents/${documentId}/sources/resolve`,
          {
            references,
          },
        );
        if (!reply.ok) return reply;
        const ids = Array.isArray(reply.value.sourceIds) ? reply.value.sourceIds : [];
        return {
          ok: true,
          value: {
            sourceIds: references.map((_, i) => (isId(ids[i]) ? (ids[i] as string) : null)),
          },
        };
      });
    },

    /**
     * What the library finds for one identifier — `GET /documents/:id/sources/lookup-id` (ADR-0103):
     * Crossref by DOI, arXiv by id, PubMed by PMID. Free; a preview, nothing is saved.
     */
    lookupId(documentId: string, query: string): Promise<Reply<Preview>> {
      return guard(documentId, async () => {
        const reply = await call<unknown>(
          `/documents/${documentId}/sources/lookup-id?q=${encodeURIComponent(query)}`,
          {},
          LOOKUP_TIMEOUT_MS,
        );
        if (!reply.ok) return reply;
        const preview = previewFrom(reply.value);
        return preview
          ? { ok: true, value: preview }
          : { ok: false, status: 404, message: 'Thesis Copilot found no record for it.' };
      });
    },

    /**
     * Adds the paper an identifier names — `POST /documents/:id/sources/import-id` (ADR-0103). The
     * server reads the record again rather than trusting the page, and finds a DOI already in the
     * library instead of adding it twice. Free.
     */
    importId(
      documentId: string,
      query: string,
    ): Promise<Reply<{ sourceId: string; alreadyPresent: boolean }>> {
      return guard(documentId, async () => {
        const reply = await call<{ sourceId?: unknown; alreadyPresent?: unknown }>(
          `/documents/${documentId}/sources/import-id`,
          { method: 'POST', body: JSON.stringify({ q: query }) },
          IMPORT_TIMEOUT_MS,
        );
        if (!reply.ok) return reply;
        const sourceId = reply.value?.sourceId;
        if (!isId(sourceId)) {
          return {
            ok: false,
            status: 502,
            message: 'Thesis Copilot sent an answer the add-on could not read.',
          };
        }
        return {
          ok: true,
          value: { sourceId, alreadyPresent: reply.value.alreadyPresent === true },
        };
      });
    },

    addToCollection(collectionId: string, sourceIds: string[]): Promise<Reply<unknown>> {
      return guard(collectionId, () => post(`/collections/${collectionId}/sources`, { sourceIds }));
    },

    /** A new library entry from the PDF itself — `POST /documents/:id/sources/upload`. */
    uploadPdf(documentId: string, file: Blob, filename: string): Promise<Reply<{ id: string }>> {
      return guard(documentId, () => {
        const form = new FormData();
        form.append('file', file, filename);
        return call<{ id: string }>(`/documents/${documentId}/sources/upload`, {
          method: 'POST',
          body: form,
        });
      });
    },

    /** The PDF of an entry already in the library — `POST /sources/:id/upload`. */
    attachPdf(sourceId: string, file: Blob, filename: string): Promise<Reply<{ id: string }>> {
      return guard(sourceId, () => {
        const form = new FormData();
        form.append('file', file, filename);
        return call<{ id: string }>(`/sources/${sourceId}/upload`, { method: 'POST', body: form });
      });
    },
  };
}

/**
 * The PDF in the student's tab. It is the student's own request for a file they are looking at,
 * with their cookies for that site; it fails when the site will not hand it over (a sign-in wall,
 * a viewer page instead of the file, or Chrome refusing the request), and the save then goes on
 * by the paper's DOI.
 */
export async function fetchPdf(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<{ ok: true; file: Blob } | { ok: false; message: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, message: 'The address of this PDF could not be read.' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, message: 'Only a PDF on a web page can be saved.' };
  }
  let response: Response;
  try {
    response = await fetcher(parsed.href, { credentials: 'include' });
  } catch {
    return { ok: false, message: 'This site would not let the add-on download the PDF.' };
  }
  if (!response.ok) {
    return { ok: false, message: `The site refused the PDF (${response.status}).` };
  }
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > PDF_MAX_BYTES) {
    return { ok: false, message: 'This PDF is larger than 50 MB.' };
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > PDF_MAX_BYTES) return { ok: false, message: 'This PDF is larger than 50 MB.' };
  // `%PDF-`: what the site sent is the file, not a sign-in page or a viewer.
  const magic = [0x25, 0x50, 0x44, 0x46, 0x2d];
  if (!magic.every((byte, i) => bytes[i] === byte)) {
    return {
      ok: false,
      message: 'The site sent a web page instead of the PDF (it may want you to sign in).',
    };
  }
  return { ok: true, file: new Blob([bytes], { type: 'application/pdf' }) };
}
