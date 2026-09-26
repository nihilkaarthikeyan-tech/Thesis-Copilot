# ADR-0033 — An optional password, with a reset by link

**Date:** 2026-09-26 · **Status:** accepted

## Context

PRD §7.2 fixes sign-in as Better Auth's email OTP plus Google. There has never been a password:
the emailed code proves the inbox every time, there is nothing to forget or leak, and "forgot
password" has no meaning. The owner, showing the sign-in screen to their manager, was asked why
there was "only email login", whether there is a password, and whether there is a reset. After
hearing the reasons for the code they said: build the password anyway, with forgot and reset.

Jenni.ai, the product we are measured against, offers both.

## Decision

Sign-in with the emailed code stays the default and keeps working for every account. A password
is something an account *may* have, added three ways:

1. **Under Account → Password**, for an account made with the code (`POST /account/password`,
   the library's server-only `setPassword`).
2. **At sign-up**, by choosing "I would rather choose a password": name, email, password. The
   account is created signed out and unverified; the emailed **link** confirms the address and
   signs the student in (`requireEmailVerification`, `autoSignInAfterVerification`). A password
   sign-in on an unconfirmed address re-sends the link rather than dead-ending.
3. **By the reset link**, which works whether or not a password existed — for a lost password
   and for "I never set one", the same page.

Rules, all Better Auth's own with our numbers: 10–128 characters and nothing else
(NIST 800-63B); scrypt hash on a `credential` account row; a reset token that lives an hour and
is spent on use; **every session is revoked on reset**, and every *other* session on a change
(the caller keeps theirs because the controller forwards the fresh cookie the library mints).
Every set, change and reset writes an audit row and emails the address a "your password was
changed" notice, because the person most likely to notice a takeover is its victim.

The forgot-password endpoint answers identically for unknown addresses and sends them nothing;
the sign-up endpoint does the same for a taken address. Neither screen can be used to learn who
has an account.

## Consequences

- `POST /account/password`, `POST /account/password/change`, `GET /account/password`; the
  library's `/sign-up/email`, `/sign-in/email`, `/request-password-reset`, `/reset-password/:token`,
  `/reset-password`, `/verify-email` under `/api/v1/auth`. New pages `/forgot-password` and
  `/reset-password`; a mode switch on `/sign-in` and `/sign-up`; a Password card on
  `/app/account`. `GET /auth/methods` now says `password: true`.
- The auth rate limit (twenty a minute per IP, §12.1) covers the password endpoints too, which is
  also the brute-force guard.
- Two things the code relied on are no longer true and were rewritten: "there are no passwords
  anywhere in this product" (`CLAUDE.md`), and the Account page's sentence saying so.
- Mails: `verifyEmailMail`, `resetPasswordMail`, `passwordChangedMail` in `auth.ts`; the dev sink
  (`/auth/dev/last-link`) remembers the last link outside production, as it does the code.
- Tests: `apps/api/test/password.spec.ts` (eleven, through HTTP against the real app) and
  `apps/web/e2e/password.spec.ts` (add under Account and sign in with it; a wrong password's
  message; the reset link end to end, and that a spent link is told apart from a bad password).
- What it does not do, deliberately: no password rules beyond length, no forced rotation, no
  "security questions", and no password on Google-only accounts unless the student adds one.
  There is still no route for someone locked out of *both* the inbox and the password — that
  would be a takeover feature (ADR-0015).
