/**
 * Thin fetch wrapper for the API — PRD §9: everything under `/api/v1`, session cookie auth,
 * errors as RFC 9457 problem details.
 *
 * The web app never parses `detail`; it switches on the stable `type` slug.
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export type ProblemDetails = {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  requestId?: string;
  [key: string]: unknown;
};

export class ApiError extends Error {
  constructor(readonly problem: ProblemDetails) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}/api/v1${path}`, {
    ...init,
    // Session cookie travels with every request (PRD §9).
    credentials: 'include',
    headers: {
      accept: 'application/json',
      // A FormData body must set its own content-type: the browser has to append the multipart
      // boundary, and overriding it with `application/json` makes the API try to JSON-parse an
      // upload. Only a body we serialised ourselves is JSON.
      ...(init.body && !(init.body instanceof FormData)
        ? { 'content-type': 'application/json' }
        : {}),
      ...(init.headers ?? {}),
    },
  });

  if (response.status === 204) return undefined as T;

  const body = (await response.json().catch(() => null)) as T | ProblemDetails | null;

  if (!response.ok) {
    const problem: ProblemDetails =
      body && typeof body === 'object' && 'type' in body
        ? (body as ProblemDetails)
        : { type: 'HTTP_ERROR', title: response.statusText, status: response.status };
    throw new ApiError(problem);
  }

  return body as T;
}
