'use client';

/**
 * Sign-in — email OTP (PRD §7.2), two steps: address, then the six-digit code.
 *
 * Google appears only when the API reports it configured (`GET /auth/methods`), so a missing
 * client id hides the button instead of showing one that fails.
 *
 * The screen is a single centred column with no illustration and no second panel: it exists for
 * about twenty seconds and the only thing that matters is that the field is obvious and the error,
 * if any, is readable. The code input is monospaced and widely tracked because a six-digit code is
 * read back character by character from another window.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { ThemeToggle } from '@/components/theme';
import { Button } from '@/components/ui/button';
import { Card, CardBody, Hint, Input, Label } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { authClient } from '@/lib/auth-client';

type Step = 'email' | 'code';

export default function SignInPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [google, setGoogle] = useState(false);

  useEffect(() => {
    api<{ emailOtp: boolean; google: boolean }>('/auth/methods')
      .then((m) => setGoogle(m.google))
      .catch(() => setGoogle(false));
  }, []);

  async function sendCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await authClient.emailOtp.sendVerificationOtp({ email, type: 'sign-in' });
    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? 'Could not send the code. Try again.');
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
      setError(result.error.message ?? 'That code did not work.');
      return;
    }
    router.push('/app');
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3.5">
          <Link href="/" className="font-serif text-[17px] font-semibold tracking-tight">
            Thesis Copilot
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[26rem] flex-1 flex-col justify-center px-6 py-14">
        <h1 className="text-balance font-serif text-[27px] font-semibold leading-tight">
          Sign in to Thesis Copilot
        </h1>
        <Hint className="mt-2 text-[14px]">
          No password. We email you a six-digit code that works for ten minutes.
        </Hint>

        <Card className="mt-6">
          <CardBody>
            {step === 'email' ? (
              <form onSubmit={sendCode} className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="email">University or personal email</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    autoFocus
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@university.edu"
                  />
                </div>
                <Button type="submit" disabled={busy || email.length === 0}>
                  {busy ? 'Sending…' : 'Email me a code'}
                </Button>
              </form>
            ) : (
              <form onSubmit={verifyCode} className="flex flex-col gap-3">
                <p className="text-[13.5px] text-muted">
                  We sent a code to <strong className="font-semibold text-ink">{email}</strong>.
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
                    className="h-11 text-center font-mono text-[19px] tracking-[0.45em]"
                    placeholder="000000"
                  />
                </div>
                <Button type="submit" disabled={busy || code.length !== 6}>
                  {busy ? 'Checking…' : 'Sign in'}
                </Button>
                <button
                  type="button"
                  className="self-start text-[12.5px] text-muted underline underline-offset-2 hover:text-ink"
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

            {google ? (
              <>
                <div className="my-4 flex items-center gap-3">
                  <hr className="flex-1 border-line" />
                  <span className="eyebrow">or</span>
                  <hr className="flex-1 border-line" />
                </div>
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() =>
                    authClient.signIn.social({ provider: 'google', callbackURL: '/app' })
                  }
                >
                  Continue with Google
                </Button>
              </>
            ) : null}
          </CardBody>
        </Card>

        {error ? (
          <p
            role="alert"
            className="mt-3 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-[13px] text-danger"
          >
            {error}
          </p>
        ) : null}

        <p className="mt-5 text-[12.5px] text-faint">
          By signing in you accept how we handle your text —{' '}
          <Link href="/privacy" className="underline underline-offset-2 hover:text-muted">
            read that first
          </Link>
          .
        </p>
      </main>
    </div>
  );
}
