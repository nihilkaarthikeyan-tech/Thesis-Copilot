/**
 * Better Auth configuration — PRD §7.2 (Better Auth, email OTP + Google, session cookies, role
 * claims), §12.1 (Secure, HttpOnly, SameSite=Lax cookies) and ADR-0033 (an optional password,
 * with a link-based reset, added at the owner's request on 2026-09-26).
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
import { ConsoleMailer, type Mail, type Mailer } from '../../common/mailer.js';
import { claimInstitutionInvite } from '../institution/claim-invite.js';
import { rememberDevLink, rememberDevOtp } from './dev-otp.js';

export type SendOtp = (input: { email: string; otp: string; type: string }) => Promise<void>;

/**
 * In development the one-time code is printed to the console instead of emailed, so the app runs
 * without a mail provider. `packages/config` requires a real transport in production.
 */
const consoleOtp: SendOtp = async ({ email, otp, type }) => {
  console.log(`[auth] one-time code for ${email} (${type}): ${otp}`);
  if (process.env.NODE_ENV !== 'production') rememberDevOtp(email, otp);
};

/** Ten minutes, matching `expiresIn` on the plugin below. */
export const OTP_MINUTES = 10;

/**
 * What the code is for, in the second person. `change-email` is the one the student has not seen
 * before and the one where getting it wrong matters: it arrives at an address that is not signed
 * in anywhere yet, so the message has to say what using it will do.
 */
const OTP_PURPOSE: Record<string, string> = {
  'sign-in': 'sign in to',
  'change-email': 'start using this address to sign in to',
};

/** The one-time-code email. Plain text: the code is the whole message, and nothing should distract from it. */
export function otpMail(input: { email: string; otp: string; type: string }): Mail {
  const purpose = OTP_PURPOSE[input.type] ?? 'confirm your email address for';
  return {
    to: [input.email],
    subject: `${input.otp} is your Thesis Copilot code`,
    text:
      `Use this code to ${purpose} Thesis Copilot:

    ${input.otp}

` +
      `It expires in ${OTP_MINUTES} minutes. If you did not ask for it, ignore this email — ` +
      'nobody can use the code without access to this inbox.',
  };
}

/**
 * How the code reaches the student: by email through the configured mailer, or — when the mailer
 * is the console one, i.e. no transport is configured — printed to the API console as before.
 * Outside production the dev OTP sink is fed either way, so the E2E can still sign in when a real
 * transport is set locally.
 */
export function otpSenderFor(mailer: Mailer): SendOtp {
  if (mailer instanceof ConsoleMailer) return consoleOtp;
  return async (input) => {
    if (process.env.NODE_ENV !== 'production') rememberDevOtp(input.email, input.otp);
    await mailer.send(otpMail(input));
  };
}

/* ------------------------------------------------------------------ passwords (ADR-0033) -- */

/** Password rules. Length is the only rule that survives contact with real users (NIST 800-63B). */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;
/** How long a reset link works. */
export const RESET_LINK_MINUTES = 60;
/** How long the "confirm your email" link after a password sign-up works. */
export const VERIFY_LINK_HOURS = 24;

export type LinkKind = 'verify-email' | 'reset-password';
export type SendLinkMail = (input: { email: string; kind: LinkKind; mail: Mail }) => Promise<void>;

/** After a password sign-up: the link that confirms the address and signs the student in. */
export function verifyEmailMail(input: { email: string; url: string }): Mail {
  return {
    to: [input.email],
    subject: 'Confirm your email for Thesis Copilot',
    text:
      `Open this link to confirm your address and sign in to Thesis Copilot:

    ${input.url}

` +
      `It works for ${VERIFY_LINK_HOURS} hours. If you did not create an account, ignore this ` +
      'email — nothing happens without the link.',
  };
}

/** The reset link. It goes only to an address that has an account; the endpoint says nothing either way. */
export function resetPasswordMail(input: { email: string; url: string }): Mail {
  return {
    to: [input.email],
    subject: 'Reset your Thesis Copilot password',
    text:
      `Someone asked to reset the password on your Thesis Copilot account. Open this link to ` +
      `choose a new one:

    ${input.url}

` +
      `It works for ${RESET_LINK_MINUTES} minutes and once only. If you did not ask for it, ` +
      'ignore this email — your password has not changed, and signing in with an emailed code ' +
      'always works too.',
  };
}

/**
 * Sent when someone signs up with an address that already has an account (2026-09-28).
 *
 * The sign-up screen answers the same way for a new address and a taken one, so it cannot be used
 * to learn who has an account. Before this mail, that meant the real owner — typically someone
 * who first came in with Google and later tried a password — saw "Check your email" and then
 * nothing at all. The screen still says nothing; the inbox, which only the owner reads, says why.
 */
export function existingAccountMail(input: { email: string; appUrl: string }): Mail {
  return {
    to: [input.email],
    subject: 'You already have a Thesis Copilot account',
    text:
      `Someone, probably you, just tried to create a Thesis Copilot account with this address. ` +
      `You already have one, so no new account was made.

` +
      `To sign in, use Continue with Google or email yourself a code:

    ${input.appUrl}/sign-in

` +
      `To sign in with a password, set one here (this works even if you have never had one):

    ${input.appUrl}/forgot-password

` +
      'If this was not you, ignore this email. Nothing on your account has changed.',
  };
}

/** Sent after a password is set, changed or reset, so a takeover is noticed by its victim. */
export function passwordChangedMail(input: { email: string; appUrl: string; how: string }): Mail {
  return {
    to: [input.email],
    subject: 'Your Thesis Copilot password was changed',
    text:
      `The password on your Thesis Copilot account was just ${input.how}.

` +
      `If that was you, there is nothing to do.

` +
      `If it was NOT you, reset it now at ${input.appUrl}/forgot-password — the link we send ` +
      'signs every other device out — and reply to this email so we can help.',
  };
}

const consoleLinkMail: SendLinkMail = async ({ email, kind, mail }) => {
  console.log(`[auth] ${kind} link for ${email}: ${mail.text}`);
  if (process.env.NODE_ENV !== 'production') rememberDevLink(email, kind, mail);
};

/**
 * Link mails (verify, reset) through the configured mailer — the console one included, so a test
 * can read what was sent. Outside production the dev sink also remembers the link, so the
 * Playwright suite can follow it without a mailbox — the same arrangement the one-time code has.
 */
export function linkMailSenderFor(mailer: Mailer): SendLinkMail {
  return async (input) => {
    if (process.env.NODE_ENV !== 'production') rememberDevLink(input.email, input.kind, input.mail);
    await mailer.send(input.mail);
  };
}

export function createAuth(
  env: Env,
  prisma: PrismaClient,
  sendOtp: SendOtp = consoleOtp,
  sendLink: SendLinkMail = consoleLinkMail,
  /** Where the "password changed" notice goes out; the console mailer when nothing is configured. */
  mailer: Mailer = new ConsoleMailer(),
) {
  const googleConfigured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

  return betterAuth({
    /**
     * ADR-0033. Sign-in stays the emailed code by default; a password is something a student may
     * add. A password sign-up must confirm the address by link before the first sign-in
     * (`requireEmailVerification`), because with a code the inbox is proved by construction and
     * a password must not become the one way in that never proved anything. A reset signs every
     * other device out.
     */
    emailAndPassword: {
      enabled: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      requireEmailVerification: true,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: RESET_LINK_MINUTES * 60,
      async sendResetPassword({ user, url }) {
        await sendLink({
          email: user.email,
          kind: 'reset-password',
          mail: resetPasswordMail({ email: user.email, url }),
        });
      },
      /**
       * A sign-up with a taken address makes nothing and says nothing on screen (above); the
       * owner is told by email instead. A failure to send is logged, never surfaced, so the
       * response stays identical to a new address's.
       */
      async onExistingUserSignUp({ user }) {
        const mail = existingAccountMail({ email: user.email, appUrl: env.APP_URL });
        if (process.env.NODE_ENV !== 'production')
          rememberDevLink(user.email, 'existing-account', mail);
        try {
          await mailer.send(mail);
        } catch (error) {
          console.error('[auth] could not send the existing-account notice', error);
        }
      },
      async onPasswordReset({ user }) {
        await prisma.auditEvent.create({
          data: { kind: 'PASSWORD_RESET', userId: user.id },
        });
        try {
          await mailer.send(
            passwordChangedMail({ email: user.email, appUrl: env.APP_URL, how: 'reset by link' }),
          );
        } catch (error) {
          console.error('[auth] could not send the password-changed notice', error);
        }
      },
    },
    emailVerification: {
      expiresIn: VERIFY_LINK_HOURS * 60 * 60,
      // Clicking the link is the sign-in; a second form after it would only lose people.
      autoSignInAfterVerification: true,
      // A password sign-in on an unconfirmed address sends the link again instead of a dead end.
      sendOnSignIn: true,
      async sendVerificationEmail({ user, url }) {
        await sendLink({
          email: user.email,
          kind: 'verify-email',
          mail: verifyEmailMail({ email: user.email, url }),
        });
      },
    },

    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    secret: env.AUTH_SECRET,
    baseURL: env.API_URL,
    basePath: '/api/v1/auth',
    trustedOrigins: [env.APP_URL],

    /**
     * Where an OAuth failure goes when the request itself cannot say (a lost or duplicated
     * `state`, 2026-09-28): the sign-in page, which reads `?error=` and says it in words. Before
     * this the student landed on the home page with the code in the address and no message.
     */
    onAPIError: { errorURL: `${env.APP_URL}/sign-in` },

    /**
     * A Google sign-in for an address that already has an account (made by the emailed code)
     * attaches to that account rather than being refused with `account_not_linked` — which is
     * what the owner met on 2026-09-25. Google verifies the address, and Better Auth's own gate
     * (`requireLocalEmailVerified`, left at its default) still refuses to link into a local
     * account whose address was never verified. `allowDifferentEmails` stays off.
     */
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ['google'],
      },
    },

    // PRD §12.1.
    advanced: {
      // PRD §0.2: every primary key is a UUID v7, generated by the `uuid_generate_v7()` column
      // default. Better Auth would otherwise insert its own random-string ids, which Postgres
      // rejects on a UUID column ("Error creating UUID, invalid character"). `false` makes the
      // adapter omit `id` on insert so the database default applies.
      database: { generateId: false },
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

    // FR-9.6: an invited address takes its institution seat the first time it signs in. At
    // sign-in rather than at account creation, because a student may already have a free-trial
    // account when their department buys seats. A failure here is logged and swallowed: a seat
    // that did not attach is a support ticket, a sign-in that did not complete is a locked-out
    // student.
    databaseHooks: {
      session: {
        create: {
          async after(session) {
            try {
              const user = await prisma.user.findUnique({
                where: { id: session.userId },
                select: { email: true },
              });
              if (user) await claimInstitutionInvite(prisma, session.userId, user.email);
            } catch (error) {
              // eslint-disable-next-line no-console
              console.error('[auth] could not claim an institution invite', error);
            }
          },
        },
      },
    },

    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 10 * 60,

        // ADR-0015. With OTP sign-in the address *is* the identity, so a student who loses their
        // university mailbox loses the thesis unless they can move the account first.
        //
        // `verifyCurrentEmail: false` is deliberate: requiring a code at the old address in order
        // to leave the old address defeats the only case this exists for. The code goes to the
        // *new* address — which is the thing actually being proved — and `EmailChangeService`
        // warns the old one that a move was asked for, while it can still be stopped.
        changeEmail: { enabled: true, verifyCurrentEmail: false },

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
