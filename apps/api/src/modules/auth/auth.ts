/**
 * Better Auth configuration — PRD §7.2 (Better Auth, email OTP + Google, session cookies, role
 * claims) and §12.1 (Secure, HttpOnly, SameSite=Lax cookies).
 *
 * Google is configured only when both credentials are present. PHASES PHASE-0 allows Google to be
 * stubbed until keys exist; email OTP alone is enough to sign in, so a missing Google key disables
 * that button rather than blocking boot.
 */

import type { Env } from '@tc/config';
import type { PrismaClient } from '@tc/db';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { emailOTP } from 'better-auth/plugins';

export type SendOtp = (input: { email: string; otp: string; type: string }) => Promise<void>;

/**
 * In development the one-time code is printed to the console instead of emailed, so the app runs
 * without a mail provider. `packages/config` requires a real transport in production.
 */
const consoleOtp: SendOtp = async ({ email, otp, type }) => {
  console.log('[auth] one-time code for ' + email + ' (' + type + '): ' + otp);
};

export function createAuth(env: Env, prisma: PrismaClient, sendOtp: SendOtp = consoleOtp) {
  const googleConfigured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

  return betterAuth({
    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    secret: env.AUTH_SECRET,
    baseURL: env.API_URL,
    basePath: '/api/v1/auth',
    trustedOrigins: [env.APP_URL],

    // PRD §12.1.
    advanced: {
      useSecureCookies: env.NODE_ENV === 'production',
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        secure: env.NODE_ENV === 'production',
      },
    },

    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },

    // Role and plan travel on the session so authorisation does not need a second query
    // (PRD §7.2 "role claims").
    user: {
      additionalFields: {
        role: { type: 'string', required: false, defaultValue: 'STUDENT', input: false },
        plan: { type: 'string', required: false, defaultValue: 'FREE_TRIAL', input: false },
        timezone: { type: 'string', required: false, defaultValue: 'Asia/Kolkata', input: false },
      },
    },

    ...(googleConfigured
      ? {
          socialProviders: {
            google: {
              clientId: env.GOOGLE_CLIENT_ID ?? '',
              clientSecret: env.GOOGLE_CLIENT_SECRET ?? '',
            },
          },
        }
      : {}),

    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 10 * 60,
        async sendVerificationOTP({ email, otp, type }) {
          await sendOtp({ email, otp, type });
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

/** Whether Google sign-in is available, so the web app can hide the button when it is not. */
export function isGoogleConfigured(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}
