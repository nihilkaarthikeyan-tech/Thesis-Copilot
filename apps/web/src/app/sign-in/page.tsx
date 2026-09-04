'use client';

/**
 * Sign-in — email OTP (PRD §7.2), two steps: address, then the six-digit code.
 *
 * Google appears only when the API reports it configured (`GET /auth/methods`), so a missing
 * client id in Phase 0 hides the button instead of showing one that fails.
 */

import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
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
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-16">
      <h1 className="font-serif text-2xl">Sign in to Thesis Copilot</h1>
      <p className="mt-2 text-sm text-muted">
        No password. We email you a six-digit code that works for ten minutes.
      </p>

      {step === 'email' ? (
        <form onSubmit={sendCode} className="mt-8 flex flex-col gap-3">
          <label className="text-sm" htmlFor="email">
            University or personal email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-10 rounded-md border border-line bg-white px-3 text-sm"
            placeholder="you@university.edu"
          />
          <Button type="submit" disabled={busy || email.length === 0}>
            {busy ? 'Sending…' : 'Email me a code'}
          </Button>
        </form>
      ) : (
        <form onSubmit={verifyCode} className="mt-8 flex flex-col gap-3">
          <p className="text-sm">
            We sent a code to <strong>{email}</strong>.
          </p>
          <label className="text-sm" htmlFor="code">
            Six-digit code
          </label>
          <input
            id="code"
            name="code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            autoComplete="one-time-code"
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            className="h-10 rounded-md border border-line bg-white px-3 font-mono text-lg tracking-[0.4em]"
            placeholder="123456"
          />
          <Button type="submit" disabled={busy || code.length !== 6}>
            {busy ? 'Checking…' : 'Sign in'}
          </Button>
          <button
            type="button"
            className="text-left text-xs text-muted underline"
            onClick={() => {
              setStep('email');
              setCode('');
            }}
          >
            Use a different email
          </button>
        </form>
      )}

      {google ? (
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => authClient.signIn.social({ provider: 'google', callbackURL: '/app' })}
        >
          Continue with Google
        </Button>
      ) : null}

      {error ? (
        <p role="alert" className="mt-4 text-sm text-warn">
          {error}
        </p>
      ) : null}
    </main>
  );
}
