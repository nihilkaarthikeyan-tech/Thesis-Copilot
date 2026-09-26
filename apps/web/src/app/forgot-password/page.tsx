'use client';

/**
 * "Forgot your password?" — ADR-0033.
 *
 * Asks for the address and always answers the same way, because the endpoint behind it says
 * nothing about whether an account exists. The link that arrives also works for someone who
 * never set a password: following it sets one. And the emailed code is always the other way in,
 * which this page says, so nobody is stuck here.
 */

import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/primitives';
import { authClient } from '@/lib/auth-client';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await authClient.requestPasswordReset({
      email,
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? 'Could not send the link. Try again in a moment.');
      return;
    }
    setSent(true);
  }

  return (
    <AuthShell
      title={sent ? 'Check your email' : 'Reset your password'}
      hint={
        sent
          ? 'If that address has an account, a link is on its way. It works for an hour and once only.'
          : 'We email you a link. Open it, choose a new password, and every other device is signed out. It also works if you never set a password.'
      }
    >
      {sent ? (
        <div
          className="mt-7 flex flex-col gap-3 text-[13.5px] text-muted"
          data-testid="forgot-done"
        >
          <p className="rounded-md border border-line bg-sunk px-3 py-2">
            Sent to <strong className="font-semibold text-ink">{email}</strong>
          </p>
          <p>
            Nothing there after a minute? Check the address, look in spam, or{' '}
            <Link href="/sign-in" className="underline underline-offset-2 hover:text-ink">
              sign in with an emailed code
            </Link>{' '}
            instead — that always works.
          </p>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-7 flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">The email you sign in with</Label>
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
              data-testid="forgot-email"
            />
          </div>
          <Button
            type="submit"
            size="lg"
            disabled={busy || email.length === 0}
            data-testid="forgot-submit"
          >
            {busy ? 'Sending…' : 'Email me a reset link'}
          </Button>
          <Link
            href="/sign-in"
            className="self-start text-[13px] text-muted underline underline-offset-2 hover:text-ink"
          >
            Back to sign in
          </Link>
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
    </AuthShell>
  );
}
