/**
 * The add-on's service worker — ADR-0031. It makes the two calls to Thesis Copilot for the popup:
 * the student's theses, and adding the paper to one of them.
 *
 * It signs nobody in. The student's own session cookie for the site goes with each request, the
 * same one the website uses, so a student signed in to Thesis Copilot in this browser is signed in
 * here, and signing out there signs the add-on out too.
 *
 * Adding goes through `POST /documents/:id/sources/resolve`, the route the library's own import
 * uses: the same lookup, the same full-text fetch, the same indexing, and the same monthly limits.
 */

import { API_URL } from './config.js';
import type { Added, Failure, Reply, Request, Thesis } from './messages.js';
import type { Paper } from './paper.js';

async function call<T>(path: string, init: RequestInit = {}): Promise<Reply<T>> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
    });
  } catch {
    return {
      ok: false,
      status: 0,
      message: 'Thesis Copilot could not be reached. Check your connection and try again.',
    };
  }
  if (!response.ok) {
    let message = `Thesis Copilot answered ${response.status}.`;
    try {
      // RFC 9457 problem details, as every error from the API is.
      const problem = (await response.json()) as { detail?: string; title?: string };
      message = problem.detail ?? problem.title ?? message;
    } catch {
      // Not JSON; the status says enough.
    }
    return { ok: false, status: response.status, message };
  }
  return { ok: true, value: (await response.json()) as T };
}

async function theses(): Promise<Reply<Thesis[]>> {
  const reply = await call<Array<{ id: string; title: string }>>('/documents');
  if (!reply.ok) return reply;
  return { ok: true, value: reply.value.map(({ id, title }) => ({ id, title })) };
}

async function add(documentId: string, paper: Paper): Promise<Reply<Added>> {
  const id = encodeURIComponent(documentId);
  if (paper.doi) {
    // The library's own duplicate check compares the reference text, and the same paper added
    // from search is written differently. The DOI is what makes two entries one paper.
    const doi = paper.doi.toLowerCase();
    const library = await call<Array<{ doi: string | null }>>(`/documents/${id}/sources`);
    if (!library.ok) return library;
    if (library.value.some((source) => source.doi?.trim().toLowerCase() === doi)) {
      return { ok: true, value: { added: false, alreadyPresent: true } };
    }
  }
  const reply = await call<{ queued: number; alreadyPresent: number }>(
    `/documents/${id}/sources/resolve`,
    {
      method: 'POST',
      body: JSON.stringify({
        references: [{ raw: paper.reference, ...(paper.doi ? { doi: paper.doi } : {}) }],
      }),
    },
  );
  if (!reply.ok) return reply;
  return {
    ok: true,
    value: { added: reply.value.queued > 0, alreadyPresent: reply.value.alreadyPresent > 0 },
  };
}

chrome.runtime.onMessage.addListener((message: Request, sender, sendResponse) => {
  // Only this add-on's own pages talk to it; a web page cannot reach `onMessage`.
  if (sender.id !== chrome.runtime.id) return false;
  const work = message.type === 'theses' ? theses() : add(message.documentId, message.paper);
  work.then(sendResponse, (error: unknown) => {
    const failure: Failure = { ok: false, status: 0, message: String(error) };
    sendResponse(failure);
  });
  // The answer is sent later, so the channel must stay open.
  return true;
});
