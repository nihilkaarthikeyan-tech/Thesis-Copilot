/**
 * The one-click unsubscribe link in a comment email (ADR-0142).
 *
 * The link carries `<userId>.<signature>`, an HMAC-SHA256 of the user id and the purpose under
 * `AUTH_SECRET`, so whoever holds the email can turn that person's comment emails off (or back
 * on) without signing in, and nobody can make a link for someone else. The worker signs, the API
 * checks; both read the same secret from the same `.env`.
 *
 * It does not expire: an unsubscribe link that stops working a month later is the kind that gets
 * a sender marked as spam. It does nothing but flip one switch on the account it names, which the
 * account page flips back. Rotating `AUTH_SECRET` invalidates every link already sent.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** What a link may switch. One for now; the purpose is signed so a later one cannot reuse it. */
export type UnsubscribePurpose = 'comments';

function signature(secret: string, userId: string, purpose: UnsubscribePurpose): string {
  return createHmac('sha256', secret)
    .update(`unsubscribe.v1.${purpose}.${userId}`)
    .digest('base64url');
}

export function unsubscribeToken(
  secret: string,
  userId: string,
  purpose: UnsubscribePurpose = 'comments',
): string {
  return `${userId}.${signature(secret, userId, purpose)}`;
}

/** The user id the token was made for, or null for anything not signed with this secret. */
export function verifyUnsubscribeToken(
  secret: string,
  token: string,
  purpose: UnsubscribePurpose = 'comments',
): string | null {
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  const userId = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(signature(secret, userId, purpose));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return userId;
}
