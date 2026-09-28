'use client';

/**
 * Starting a Google sign-in, and explaining one that did not finish (2026-09-28).
 *
 * Better Auth keeps a one-time `state` value in a cookie and checks it when Google sends the
 * student back. A second press of the button minted a second state and overwrote the cookie, so
 * the first Google reply no longer matched and the sign-in failed with `state_mismatch`, which
 * the owner hit on production, landing on the home page with nothing but `?error=` in the
 * address. Now the button starts one sign-in only, every return, good or bad, comes back to an
 * absolute address on this site, and the error is said in words on the page that can retry it.
 */

import { authClient } from '@/lib/auth-client';

const MESSAGES: Record<string, string> = {
  state_mismatch:
    'Google sign-in didn’t finish. This happens if the button was pressed twice or the Google tab was left open too long. Press “Continue with Google” once more.',
  state_not_found:
    'Google sign-in didn’t finish. This happens if the button was pressed twice or the Google tab was left open too long. Press “Continue with Google” once more.',
  access_denied: 'Google sign-in was cancelled. Nothing was changed.',
  account_not_linked:
    'That Google address already has an account here. Email yourself a code to sign in; Google will work after that.',
};

/** Null when there is no error code; otherwise the sentence to show. */
export function googleErrorMessage(code: string | null): string | null {
  if (!code) return null;
  return (
    MESSAGES[code] ?? 'Google sign-in didn’t finish. Try again, or email yourself a code instead.'
  );
}

/**
 * Starts one Google sign-in. `back` is the page to return to if it fails (this page), `next`
 * where to go once it succeeds. Both absolute, because in development the API and the web app
 * are on different ports and a bare path would resolve against the API.
 */
export async function startGoogleSignIn(input: {
  next: string;
  back: string;
}): Promise<string | null> {
  const origin = window.location.origin;
  const result = await authClient.signIn.social({
    provider: 'google',
    callbackURL: `${origin}${input.next}`,
    errorCallbackURL: `${origin}${input.back}`,
  });
  if (result?.error) return googleErrorMessage(result.error.code ?? 'unknown');
  return null;
}
