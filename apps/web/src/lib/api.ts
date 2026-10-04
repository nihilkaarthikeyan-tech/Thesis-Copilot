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

/** What a student reads when the server cannot be reached, instead of "Failed to fetch". */
export const NETWORK_FAILURE_MESSAGE =
  'We could not reach the server. Check your connection and try again.';

/**
 * A request that never got an answer — offline, DNS, CORS, the API down. `fetch` reports all of
 * these as a bare `TypeError` ("Failed to fetch" in Chrome, "NetworkError when attempting to fetch
 * resource." in Firefox, "Load failed" in Safari), which pages used to print as it came.
 */
export function networkProblem(): ProblemDetails {
  return {
    type: 'NETWORK_UNREACHABLE',
    title: NETWORK_FAILURE_MESSAGE,
    detail: NETWORK_FAILURE_MESSAGE,
    status: 0,
  };
}

/** True for an error `api()` raised because the server could not be reached. */
export function isNetworkFailure(error: unknown): boolean {
  return error instanceof ApiError && error.problem.type === 'NETWORK_UNREACHABLE';
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await send(path, init);
  } catch (error) {
    // An abort is the caller's own doing (a closed panel, a superseded request): pass it on.
    if (error instanceof TypeError) throw new ApiError(networkProblem());
    throw error;
  }

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

function send(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${API_URL}/api/v1${path}`, {
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
}
