'use client';

/**
 * Sign in / sign up — email OTP (PRD §7.2), with Google when it is configured, and a password
 * for an account that set one (ADR-0033).
 *
 * Mechanically identical to `/sign-up`: with an email code the first use of an address creates the
 * account, so either page will do either job, and both say so. The two exist because the person
 * arriving here is asking "let me back in" while the one arriving at `/sign-up` is asking "what do
 * I get" — one screen would have to answer both and would answer neither well.
 *
 * Two columns. The right is the form; the left is the reason to trust it, because this is the first
 * screen a student sees after the marketing page and the thing they are actually deciding is
 * whether an AI tool will get them into trouble (§12.3). On a narrow screen the left column is
 * dropped rather than stacked — it is reassurance, not instruction, and a phone should get to the
 * field immediately.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { ThemeToggle } from '@/components/theme';
import { Button } from '@/components/ui/button';
import { Hint, Input, Kbd, Label } from '@/components/ui/primitives';
import { safeNext } from '@/lib/admin-gate';
import { api } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { passwordSignInProblem } from '@/lib/password';

type Step = 'email' | 'code';
/** The emailed code is the default; a password is for an account that set one. */
type Mode = 'code' | 'password';

/** Google's mark. Inline because the CSP allows no external images and it must not be recoloured. */
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

export default function SignInPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [google, setGoogle] = useState(false);
  const [mode, setMode] = useState<Mode>('code');
  const [password, setPassword] = useState('');
  const [passwordOn, setPasswordOn] = useState(true);
  // Where to go after signing in: `?next=/admin` when a protected page sent the visitor here.
  // Read from the address in an effect rather than `useSearchParams`, which needs a Suspense
  // boundary for a statically rendered page. `?mode=password` is what the reset page links to.
  const [next, setNext] = useState('/app');
  useEffect(() => {
    const params = new URL(window.location.href).searchParams;
    setNext(safeNext(params.get('next')));
    if (params.get('mode') === 'password') setMode('password');
  }, []);

  useEffect(() => {
    api<{ emailOtp: boolean; password?: boolean; google: boolean }>('/auth/methods')
      .then((m) => {
        setGoogle(m.google);
        setPasswordOn(m.password !== false);
      })
      .catch(() => setGoogle(false));
  }, []);

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
    router.push(next);
  }

  async function signInWithPassword(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    // The return address rides along so that, for an address never confirmed, the link the
    // library re-sends lands back in the product and not on the API's root.
    const result = await authClient.signIn.email({
      email,
      password,
      callbackURL: `${window.location.origin}${next}`,
    });
    setBusy(false);
    if (result.error) {
      setError(passwordSignInProblem(result.error.code, result.error.message));
      return;
    }
    router.push(next);
  }

  function switchMode(to: Mode) {
    setMode(to);
    setError(null);
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3.5">
          <Link href="/" className="font-serif text-[17px] font-semibold tracking-tight">
            Thesis Copilot
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/pricing" className="text-[13px] text-muted hover:text-ink">
              Pricing
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 items-stretch lg:grid-cols-2">
        {/* ------------------------------------------------------ the case -- */}
        <section className="hidden flex-col justify-center border-r border-line bg-sunk px-10 py-14 lg:flex">
          <p className="eyebrow">Before you sign in</p>
          <h2 className="mt-3 max-w-[18ch] text-balance font-serif text-[30px] font-semibold leading-[1.15]">
            It only cites what it can show you.
          </h2>

          <div className="mt-8 rounded-md border border-line bg-surface">
            <div className="border-b border-line px-4 py-2 text-[11px] text-faint">
              Chapter 1 · Introduction
            </div>
            <div className="px-4 py-4">
              <p className="font-serif text-[13.5px] leading-[1.75] text-ink">
                Household adoption of rooftop solar remains low despite falling panel prices{' '}
                <span className="font-semibold text-accent">(Kumar, 2021)</span>.{' '}
                <span className="text-ghost">
                  This puzzle motivates the research: what barriers prevent rural households from
                  adopting the technology?
                </span>
              </p>
              <p className="mt-3 flex items-center gap-1.5 text-[11px] text-faint">
                <Kbd>Ctrl+/</Kbd> suggests · <Kbd>Tab</Kbd> keeps it · <Kbd>Esc</Kbd> discards
              </p>
            </div>
          </div>

          <ul className="mt-8 grid list-none gap-3 p-0 text-[13.5px] leading-relaxed text-muted">
            <li className="border-l-2 border-line pl-3.5">
              <strong className="font-semibold text-ink">Grey is not yours yet.</strong> Nothing
              enters your thesis until you accept it.
            </li>
            <li className="border-l-2 border-line pl-3.5">
              <strong className="font-semibold text-ink">It cannot invent a source.</strong> The
              model may only cite passages it was shown.
            </li>
            <li className="border-l-2 border-line pl-3.5">
              <strong className="font-semibold text-ink">Everything is logged.</strong> Export the
              record and hand it to your guide.
            </li>
          </ul>
        </section>

        {/* ---------------------------------------------------------- form -- */}
        <section className="flex flex-col justify-center px-6 py-14 sm:px-12">
          <div className="mx-auto w-full max-w-[24rem]">
            <h1 className="text-balance font-serif text-[30px] font-semibold leading-tight">
              {step === 'email' ? 'Sign in or create an account' : 'Check your email'}
            </h1>
            <Hint className="mt-2 text-[14px]">
              {step === 'code'
                ? 'The code works for ten minutes. It may take a moment to arrive.'
                : mode === 'password'
                  ? 'Sign in with the password you set under Account. No password yet? Email yourself a code instead, or use “Forgot your password?” to make one.'
                  : 'We email you a six-digit code that works for ten minutes — and if this address is new, that first code creates your account. No password needed; add one later if you prefer.'}
            </Hint>

            {step === 'email' && mode === 'password' ? (
              <form onSubmit={signInWithPassword} className="mt-7 flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="email">University or personal email</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="username"
                    autoFocus
                    required
                    className="h-11"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@university.edu"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between">
                    <Label htmlFor="password">Password</Label>
                    <Link
                      href="/forgot-password"
                      className="text-[12.5px] text-muted underline underline-offset-2 hover:text-ink"
                      data-testid="forgot-password"
                    >
                      Forgot your password?
                    </Link>
                  </div>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    className="h-11"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <Button
                  type="submit"
                  size="lg"
                  disabled={busy || email.length === 0 || password.length === 0}
                >
                  {busy ? 'Signing in…' : 'Sign in'}
                </Button>
                <button
                  type="button"
                  data-testid="mode-code"
                  className="self-start text-[13px] text-muted underline underline-offset-2 hover:text-ink"
                  onClick={() => switchMode('code')}
                >
                  Email me a code instead
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
                    autoFocus
                    required
                    className="h-11"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@university.edu"
                  />
                </div>
                <Button type="submit" size="lg" disabled={busy || email.length === 0}>
                  {busy ? 'Sending…' : 'Email me a code'}
                </Button>
                {passwordOn ? (
                  <button
                    type="button"
                    data-testid="mode-password"
                    className="self-start text-[13px] text-muted underline underline-offset-2 hover:text-ink"
                    onClick={() => switchMode('password')}
                  >
                    Use a password instead
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
                    autoFocus
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    className="h-14 text-center font-mono text-[24px] tracking-[0.4em]"
                    placeholder="000000"
                  />
                </div>
                <Button type="submit" size="lg" disabled={busy || code.length !== 6}>
                  {busy ? 'Checking…' : 'Sign in'}
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
                  onClick={() =>
                    authClient.signIn.social({ provider: 'google', callbackURL: next })
                  }
                >
                  <GoogleMark />
                  Continue with Google
                </Button>
              </>
            ) : null}

            <p className="mt-8 border-t border-line pt-4 text-[13px] text-muted">
              New here?{' '}
              <Link href="/sign-up" className="font-semibold text-accent hover:underline">
                Create an account
              </Link>
              {mode === 'password'
                ? ' — with an emailed code or a password of your choosing.'
                : ' — or just enter your address above; the first code creates it.'}
            </p>

            <p className="mt-4 text-[12.5px] leading-relaxed text-faint">
              By continuing you accept our{' '}
              <Link href="/terms" className="underline underline-offset-2 hover:text-muted">
                terms
              </Link>{' '}
              and how we handle your text —{' '}
              <Link href="/privacy" className="underline underline-offset-2 hover:text-muted">
                read that first
              </Link>
              . We never train on your thesis.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
