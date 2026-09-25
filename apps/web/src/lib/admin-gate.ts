'use client';

/**
 * Who may see an admin screen, decided the same way on every one (2026-09-25).
 *
 * The owner pressed Sign out on the new admin header and got a half page: the public cost-model
 * block, a "Sign in" link buried in a sentence, and a Sign out button for a session that no
 * longer existed. Now a signed-out visitor is sent to sign in and brought back afterwards
 * (`?next=`), and a signed-in student is told plainly that their account is not an
 * administrator's. The API still refuses every admin request on its own; this only decides
 * what the page says.
 */

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ApiError } from '@/lib/api';
import { useSession } from '@/lib/auth-client';

export type AdminGate = {
  /** `loading` until the session is known. */
  state: 'loading' | 'anonymous' | 'not-admin' | 'admin';
  signedInAs: string | null;
};

/** Only a path on this site: a `next` of `//evil.example` or `https://…` is not followed. */
export function safeNext(next: string | null | undefined, fallback = '/app'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) {
    return fallback;
  }
  return next;
}

export const signInUrlFor = (path: string) => `/sign-in?next=${encodeURIComponent(path)}`;

export function useAdminGate(): AdminGate {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const user = session.data?.user as { email?: string; role?: string } | undefined;
  const state: AdminGate['state'] = session.isPending
    ? 'loading'
    : !user
      ? 'anonymous'
      : user.role === 'SUPERADMIN'
        ? 'admin'
        : 'not-admin';

  useEffect(() => {
    if (state === 'anonymous') router.replace(signInUrlFor(pathname || '/admin'));
  }, [state, router, pathname]);

  return { state, signedInAs: user?.email ?? null };
}

/**
 * For an admin page's API failure: a 401 means the session ended under the page — go and sign
 * in again, coming back here. Anything else is the page's own to show.
 */
export function isSessionGone(error: unknown): boolean {
  return error instanceof ApiError && error.problem.status === 401;
}
