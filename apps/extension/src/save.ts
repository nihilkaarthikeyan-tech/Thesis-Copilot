/**
 * Saving papers to a thesis library — ADR-0069. One function for the single paper on an article
 * page, the ticked results of a results page, and the tab's PDF; the service worker runs it.
 *
 * 1. The library is read once. A paper whose DOI is already in it is "already in the library"
 *    (the route's own check compares the reference text, and the same paper added from search is
 *    written differently — ADR-0031).
 * 2. The rest go through `POST /documents/:id/sources/resolve` — the library's own import, with
 *    its lookup, full-text fetch, indexing and limits — ten at a time, so the student sees
 *    progress and one failure does not lose the rest.
 * 3. Everything saved or already there joins the chosen collection.
 * 4. The tab's PDF, when there is one, is attached to the paper: to the row just resolved when the
 *    page names a DOI, or uploaded as a new entry when nothing else names the paper. A PDF that
 *    cannot be fetched is said so, and the paper is still saved by its DOI.
 *
 * Pure apart from the `api` passed in, so it is tested with a fake one.
 */

import type { Api } from './api.js';
import { isId } from './api.js';
import type {
  ItemResult,
  PdfOutcome,
  SaveJob,
  SaveOneJob,
  SaveOneResult,
  SaveResult,
} from './messages.js';
import { checkPaper, doiCandidates } from './paper.js';
import { checkRef, refQuery } from './refs.js';

/**
 * An in-page button's save as the service worker accepts it (ADR-0125): every id a UUID, the
 * identifier exactly one the cleaners would make, the paper checked field by field. A content
 * script runs inside someone else's page, so its message is checked like any other input.
 */
export function checkSaveOneJob(value: unknown): SaveOneJob | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (!isId(v.documentId)) return null;
  let collectionId: string | null = null;
  if (v.collectionId !== null && v.collectionId !== undefined) {
    if (!isId(v.collectionId)) return null;
    collectionId = v.collectionId;
  }
  let ref: SaveOneJob['ref'] = null;
  if (v.ref !== null && v.ref !== undefined) {
    ref = checkRef(v.ref);
    if (!ref) return null;
  }
  const paper = checkPaper(v.paper);
  if (!paper) return null;
  return { documentId: v.documentId, collectionId, ref, paper };
}

export const RESOLVE_BATCH = 10;

export type SaveDeps = {
  api: Pick<Api, 'library' | 'resolve' | 'addToCollection' | 'uploadPdf' | 'attachPdf'>;
  fetchPdf: (url: string) => Promise<{ ok: true; file: Blob } | { ok: false; message: string }>;
};

export async function runSave(
  job: SaveJob,
  deps: SaveDeps,
  progress: (results: ItemResult[]) => void = () => undefined,
): Promise<SaveResult> {
  const results = new Map<string, ItemResult>();
  const report = () =>
    progress(job.items.map((i) => results.get(i.key)).filter((r): r is ItemResult => Boolean(r)));
  const failRest = (message: string) => {
    for (const item of job.items) {
      if (!results.has(item.key))
        results.set(item.key, { key: item.key, status: 'failed', sourceId: null, message });
    }
  };
  const finish = (
    pdf: PdfOutcome | null,
    collection: SaveResult['collection'],
    signedOut = false,
  ): SaveResult => {
    report();
    return {
      results: job.items.map((i) => results.get(i.key) as ItemResult),
      pdf,
      collection,
      signedOut,
    };
  };

  const library = await deps.api.library(job.documentId);
  if (!library.ok) {
    failRest(library.message);
    return finish(null, null, library.status === 401);
  }
  const byDoi = new Map<string, { id: string; hasFile: boolean }>();
  for (const row of library.value) {
    if (row.doi) byDoi.set(row.doi.trim().toLowerCase(), { id: row.id, hasFile: row.hasFile });
  }

  const single = job.items.length === 1 ? job.items[0] : undefined;
  let pdf: PdfOutcome | null = null;

  // A PDF that names no paper (no DOI on the page or in its address) is saved as the file itself.
  if (job.pdf && single && !single.paper.doi) {
    const fetched = await deps.fetchPdf(job.pdf.url);
    if (fetched.ok) {
      const uploaded = await deps.api.uploadPdf(job.documentId, fetched.file, job.pdf.filename);
      if (uploaded.ok) {
        results.set(single.key, { key: single.key, status: 'saved', sourceId: uploaded.value.id });
        return finish({ kind: 'attached' }, await collect(job, deps, results));
      }
      if (uploaded.status === 401) {
        failRest(uploaded.message);
        return finish(null, null, true);
      }
      pdf = { kind: 'rejected', message: uploaded.message };
    } else {
      pdf = { kind: 'not-fetched', message: fetched.message };
    }
    // The file could not be saved; a scholarly title on the page can still be looked up below.
    if (job.pdf.onlyThePdf) {
      failRest(pdf.message);
      return finish(pdf, null);
    }
  }

  const fresh: SaveJob['items'] = [];
  const queued = new Set<string>();
  for (const item of job.items) {
    const doi = item.paper.doi?.toLowerCase();
    // A DOI read from an address may carry a publisher's path part after it (`doiCandidates`):
    // the library row under the shorter DOI is the same paper.
    const known = doi
      ? doiCandidates(doi)
          .map((candidate) => byDoi.get(candidate))
          .find(Boolean)
      : undefined;
    if (known) {
      results.set(item.key, { key: item.key, status: 'present', sourceId: known.id });
    } else if (doi && queued.has(doi)) {
      // The same paper twice on one page is one entry; its result is copied below.
    } else {
      if (doi) queued.add(doi);
      fresh.push(item);
    }
  }
  report();

  for (let start = 0; start < fresh.length; start += RESOLVE_BATCH) {
    const batch = fresh.slice(start, start + RESOLVE_BATCH);
    const reply = await deps.api.resolve(
      job.documentId,
      batch.map(({ paper }) => ({
        raw: paper.reference,
        ...(paper.doi ? { doi: paper.doi } : {}),
      })),
    );
    if (!reply.ok) {
      for (const item of batch) {
        results.set(item.key, {
          key: item.key,
          status: 'failed',
          sourceId: null,
          message: reply.message,
        });
      }
      if (reply.status === 401) {
        failRest(reply.message);
        return finish(pdf, null, true);
      }
    } else {
      batch.forEach((item, i) => {
        const sourceId = reply.value.sourceIds[i] ?? null;
        results.set(
          item.key,
          sourceId
            ? { key: item.key, status: 'saved', sourceId }
            : {
                key: item.key,
                status: 'failed',
                sourceId: null,
                message: 'Thesis Copilot did not take this one.',
              },
        );
      });
    }
    report();
  }

  // A repeat of a paper earlier on the page shares that paper's result.
  for (const item of job.items) {
    if (results.has(item.key)) continue;
    const doi = item.paper.doi?.toLowerCase();
    const twin = job.items.find(
      (other) => other.paper.doi?.toLowerCase() === doi && results.has(other.key),
    );
    const shared = twin ? results.get(twin.key) : undefined;
    results.set(
      item.key,
      shared ? { ...shared, key: item.key } : { key: item.key, status: 'failed', sourceId: null },
    );
  }

  const collection = await collect(job, deps, results);

  if (job.pdf && single?.paper.doi && !pdf) {
    const result = results.get(single.key);
    const sourceId = result?.sourceId;
    const known = byDoi.get(single.paper.doi.toLowerCase());
    if (!sourceId) {
      pdf = null;
    } else if (result?.status === 'present' && known?.hasFile) {
      pdf = { kind: 'already-has-file' };
    } else {
      const fetched = await deps.fetchPdf(job.pdf.url);
      if (!fetched.ok) {
        pdf = { kind: 'not-fetched', message: fetched.message };
      } else {
        const attached = await deps.api.attachPdf(sourceId, fetched.file, job.pdf.filename);
        pdf = attached.ok ? { kind: 'attached' } : { kind: 'rejected', message: attached.message };
      }
    }
  }

  return finish(pdf, collection);
}

async function collect(
  job: SaveJob,
  deps: SaveDeps,
  results: Map<string, ItemResult>,
): Promise<SaveResult['collection']> {
  if (!job.collectionId) return null;
  const ids = [
    ...new Set(
      [...results.values()]
        .filter((r) => r.status !== 'failed' && r.sourceId)
        .map((r) => r.sourceId as string),
    ),
  ];
  if (ids.length === 0) return null;
  const reply = await deps.api.addToCollection(job.collectionId, ids);
  return reply.ok ? 'added' : 'failed';
}

export type SaveOneDeps = {
  api: Pick<
    Api,
    'importId' | 'library' | 'resolve' | 'addToCollection' | 'uploadPdf' | 'attachPdf'
  >;
};

/**
 * One paper from an in-page button — ADR-0125.
 *
 * With an identifier, through the library's paste-an-ID import (`import-id`, ADR-0103): the
 * server reads the record for that identifier again, so what is saved is what the identifier
 * names and nothing the page could misdescribe; a DOI already in the library is found, not
 * added twice. Only when the server has no record for it (404) does the paper go the popup's way
 * — `runSave`, through resolve, by its details and DOI — and so does a result with no identifier
 * at all. Every failure carries its reason; nothing fails silently.
 */
export async function saveOne(job: SaveOneJob, deps: SaveOneDeps): Promise<SaveOneResult> {
  const key = 'one';
  if (job.ref) {
    const reply = await deps.api.importId(job.documentId, refQuery(job.ref));
    if (reply.ok) {
      const { sourceId, alreadyPresent } = reply.value;
      const collection = job.collectionId
        ? (await deps.api.addToCollection(job.collectionId, [sourceId])).ok
          ? ('added' as const)
          : ('failed' as const)
        : null;
      return {
        key,
        status: alreadyPresent ? 'present' : 'saved',
        sourceId,
        collection,
        signedOut: false,
        via: 'id',
      };
    }
    if (reply.status === 401) {
      return {
        key,
        status: 'failed',
        sourceId: null,
        message: reply.message,
        collection: null,
        signedOut: true,
        via: 'id',
      };
    }
    if (reply.status !== 404) {
      return {
        key,
        status: 'failed',
        sourceId: null,
        message: reply.message,
        collection: null,
        signedOut: false,
        via: 'id',
      };
    }
    // 404: no record for the identifier. The paper as the page describes it still goes in.
  }
  const saved = await runSave(
    {
      runId: 'in-page',
      documentId: job.documentId,
      collectionId: job.collectionId,
      items: [{ key, paper: job.paper }],
      pdf: null,
    },
    { api: deps.api, fetchPdf: async () => ({ ok: false, message: 'No PDF from the page.' }) },
  );
  const result = saved.results[0] ?? { key, status: 'failed' as const, sourceId: null };
  return {
    ...result,
    ...(result.status === 'failed' && !result.message
      ? { message: 'Thesis Copilot did not take this one.' }
      : {}),
    collection: saved.collection,
    signedOut: saved.signedOut,
    via: 'details',
  };
}
