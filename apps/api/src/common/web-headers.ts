/**
 * Fastify's headers as a `Headers`, which is what Better Auth speaks.
 *
 * Better Auth is built on the web `Request`/`Response` API, so every call into it — the catch-all
 * proxy in `auth.controller.ts`, the session lookup in `session.guard.ts`, the email change in
 * `email-change.service.ts` — has to convert at the boundary. Three identical copies of this loop
 * is how the fourth one ends up subtly different.
 *
 * A repeated header arrives from Fastify as an array. Joining with `, ` is what RFC 9110 §5.3
 * says a recipient may do, and it is what matters for `cookie` — the only repeatable header any
 * of these paths reads.
 */

import type { FastifyRequest } from 'fastify';

export function toWebHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
  }
  return headers;
}
