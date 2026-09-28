'use client';

/**
 * `/sign-up` — the same email-OTP flow as `/sign-in`, framed for someone who has no account.
 *
 * Mechanically there is one flow: with an email code, the first use of an address creates the
 * account, and Better Auth needs no separate endpoint. But a person arriving from "Start writing"
 * is asking a different question — *what do I get, and what will this cost me* — than one arriving
 * at "Sign in", who is asking *let me back in*. Sending both to one screen means one of them reads
 * copy written for the other, so the route exists and answers its own question: the trial's real
 * allowances, and that no card is involved.
 *
 * Anyone who already has an account can type their address here and it simply signs them in. That
 * is stated rather than hidden, because being told "account already exists" after committing to a
 * form is the most annoying way to learn it.
 */

import { PLAN_LIMITS } from '@tc/config';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { AuthFrame } from '@/components/marketing/AuthFrame';
import { Button } from '@/components/ui/button';
import { Hint, Input, Label } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { googleErrorMessage, startGoogleSignIn } from '@/lib/google-sign-in';
import { PASSWORD_MIN_LENGTH, passwordProblem } from '@/lib/password';

type Step = 'email' | 'code' | 'link';

/** The trial's real allowances, read from the same table the cap check uses (PRD §11.3). */
const TRIAL_CAPS = PLAN_LIMITS.FREE_TRIAL.caps;
const TRIAL_DAYS = PLAN_LIMITS.FREE_TRIAL.trialDays ?? 14;

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H.96v2.34A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.98 10.72a5.4 5.4 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.02-2.34Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.9 11.42 0 9 0A9 9 0 0 0 .96 4.94l3.02 2.34C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

export default function SignUpPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [google, setGoogle] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  // ADR-0033: the code is the default; a password sign-up confirms the address by link instead.
  const [mode, setMode] = useState<'code' | 'password'>('code');
  const [passwordOn, setPasswordOn] = useState(true);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');

  // A Google sign-up that did not finish comes back here with `?error=`.
  useEffect(() => {
    const failed = googleErrorMessage(new URL(window.location.href).searchParams.get('error'));
    if (failed) setError(failed);
  }, []);

  async function continueWithGoogle() {
    if (googleBusy) return;
    setGoogleBusy(true);
    setError(null);
    const failed = await startGoogleSignIn({ next: '/app', back: '/sign-up' });
    if (failed) {
      setError(failed);
      setGoogleBusy(false);
    }
  }

  useEffect(() => {
    api<{ emailOtp: boolean; password?: boolean; google: boolean }>('/auth/methods')
      .then((m) => {
        setGoogle(m.google);
        setPasswordOn(m.password !== false);
      })
      .catch(() => setGoogle(false));
  }, []);

  async function createWithPassword(event: FormEvent) {
    event.preventDefault();
    const problem = passwordProblem(password);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    // The library answers the same way for a new address and a taken one, and sends the link
    // only to the new one — so this screen cannot be used to learn who has an account.
    const result = await authClient.signUp.email({
      name: name.trim(),
      email,
      password,
      callbackURL: `${window.location.origin}/app`,
    });
    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? 'Could not create the account. Try again.');
      return;
    }
    setStep('link');
  }

  async function sendCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await authClient.emailOtp.sendVerificationOtp({ email, type: 'sign-in' });
    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? 'Could not send the code. Check the address and try again.');
      return;
    }
    setStep('code');
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await authClient.signIn.emailOtp({ email, otp: code });
    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? 'That code did not work. Ask for a new one.');
      return;
    }
    router.push('/app');
  }

  return (
    <AuthFrame
      photo="/landing/library-cafe.webp"
      photoAlt="A student reading a book at a library table"
      cardTitle={`What the ${TRIAL_DAYS}-day free trial includes`}
      cardBody={`${TRIAL_CAPS.ASSIST} writing suggestions, ${TRIAL_CAPS.DRAFT} drafted sections, ${TRIAL_CAPS.CITE} citation lookups and ${TRIAL_CAPS.VIVA} viva practice uses a month. Everything works, in smaller amounts.`}
      cardPoints={['No card', 'Nothing deleted if you stop']}
    >
      <h1 className="text-balance">
        {step === 'email' ? 'Create your account' : 'Check your email'}
      </h1>
      <Hint className="mt-2 text-[14px]">
        {step === 'code'
          ? 'The code works for ten minutes. It may take a moment to arrive.'
          : step === 'link'
            ? 'Open the link we sent to confirm the address. That signs you in; it works for 24 hours.'
            : mode === 'password'
              ? 'Choose a password now; we email you a link to confirm the address before the first sign-in. An emailed code will always work too.'
              : 'Enter your email and we send a six-digit code. That code creates the account — no password to choose, and you can add one later.'}
      </Hint>

      {step === 'link' ? (
        <div
          className="mt-7 flex flex-col gap-3 text-[13.5px] text-muted"
          data-testid="signup-link-sent"
        >
          <p className="rounded-md border border-line bg-sunk px-3 py-2">
            Sent to <strong className="font-semibold text-ink">{email}</strong>
          </p>
          <p>
            Nothing there after a minute? Check spam, or{' '}
            <button
              type="button"
              className="underline underline-offset-2 hover:text-ink"
              onClick={() => {
                setStep('email');
                setMode('code');
                setError(null);
              }}
            >
              create the account with a code instead
            </button>
            .
          </p>
        </div>
      ) : step === 'email' && mode === 'password' ? (
        <form onSubmit={createWithPassword} className="mt-7 flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Your name</Label>
            <Input
              id="name"
              name="name"
              autoComplete="name"
              required
              className="h-11"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="As your guide knows you"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">University or personal email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              className="h-11"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@university.edu"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              className="h-11"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Hint>At least {PASSWORD_MIN_LENGTH} characters. A short sentence is ideal.</Hint>
          </div>
          <Button
            type="submit"
            size="lg"
            disabled={busy || email.length === 0 || password.length === 0 || name.trim() === ''}
          >
            {busy ? 'Creating…' : 'Create my account'}
          </Button>
          <button
            type="button"
            data-testid="mode-code"
            className="self-start text-[13px] text-muted underline underline-offset-2 hover:text-ink"
            onClick={() => {
              setMode('code');
              setError(null);
            }}
          >
            Use an emailed code instead — no password
          </button>
        </form>
      ) : step === 'email' ? (
        <form onSubmit={sendCode} className="mt-7 flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">University or personal email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="h-11"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@university.edu"
            />
            <Hint>
              Use the address your guide knows you by — shared drafts and comments go to it.
            </Hint>
          </div>
          <Button type="submit" size="lg" disabled={busy || email.length === 0}>
            {busy ? 'Sending…' : 'Create my account'}
          </Button>
          {passwordOn ? (
            <button
              type="button"
              data-testid="mode-password"
              className="self-start text-[13px] text-muted underline underline-offset-2 hover:text-ink"
              onClick={() => {
                setMode('password');
                setError(null);
              }}
            >
              I would rather choose a password
            </button>
          ) : null}
        </form>
      ) : (
        <form onSubmit={verifyCode} className="mt-7 flex flex-col gap-3">
          <p className="rounded-md border border-line bg-sunk px-3 py-2 text-[13px] text-muted">
            Sent to <strong className="font-semibold text-ink">{email}</strong>
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="code">Six-digit code</Label>
            <Input
              id="code"
              name="code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className="h-14 text-center font-mono text-[24px] tracking-[0.4em]"
              placeholder="000000"
            />
          </div>
          <Button type="submit" size="lg" disabled={busy || code.length !== 6}>
            {busy ? 'Checking…' : 'Create account and start'}
          </Button>
          <button
            type="button"
            className="self-start text-[13px] text-muted underline underline-offset-2 hover:text-ink"
            onClick={() => {
              setStep('email');
              setCode('');
              setError(null);
            }}
          >
            Use a different email
          </button>
        </form>
      )}

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-[13px] text-danger"
        >
          {error}
        </p>
      ) : null}

      {google && step === 'email' ? (
        <>
          <div className="my-6 flex items-center gap-3">
            <hr className="flex-1 border-line" />
            <span className="eyebrow">or</span>
            <hr className="flex-1 border-line" />
          </div>
          <Button
            variant="secondary"
            size="lg"
            className="w-full"
            disabled={googleBusy}
            aria-busy={googleBusy}
            data-testid="google-sign-up"
            onClick={() => void continueWithGoogle()}
          >
            <GoogleMark />
            {googleBusy ? 'Opening Google…' : 'Sign up with Google'}
          </Button>
        </>
      ) : null}

      <p className="mt-8 border-t border-line pt-4 text-[13px] text-muted">
        Already have an account?{' '}
        <Link href="/sign-in" className="font-semibold text-accent hover:underline">
          Sign in
        </Link>
        <span className="mt-1 block text-[12.5px] text-faint">
          Either page works — the same code signs you in or creates the account.
        </span>
      </p>
    </AuthFrame>
  );
}
