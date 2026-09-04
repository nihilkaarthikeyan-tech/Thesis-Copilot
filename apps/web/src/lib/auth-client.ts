/**
 * Better Auth browser client — PRD §7.2. Talks to the API's `/api/v1/auth/*` mount.
 *
 * Only the email-OTP plugin is wired here. Google sign-in is offered when
 * `GET /api/v1/auth/methods` says it is configured; the button simply is not rendered otherwise.
 */

import { emailOTPClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import { API_URL } from './api';

export const authClient = createAuthClient({
  baseURL: API_URL,
  basePath: '/api/v1/auth',
  plugins: [emailOTPClient()],
});

export const { useSession, signOut } = authClient;
