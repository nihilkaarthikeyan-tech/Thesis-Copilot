'use client';

/**
 * The page the reset link lands on — ADR-0033.
 *
 * Better Auth checks the token first and redirects here with `?token=` when it is good and
 * `?error=INVALID_TOKEN` when it is not, so an expired link is told apart from a bad password
 * before anything is typed. The token is read from the address in an effect, not with
 * `useSearchParams`, which would want a Suspense boundary on a static page.
 */

import Link from 'next/link';
import { type FormEvent, useEffect, useState } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { Button } from '@/components/ui/button';
import { Hint, Input, Label } from '@/components/ui/primitives';
import { authClient } from '@/lib/auth-client';
import { PASSWORD_MIN_LENGTH, passwordProblem, resetProblem } from '@/lib/password';

type State = 'checking' | 'invalid' | 'form' | 'done';

export default function ResetPasswordPage() {
  const [state, setState] = useState<State>('checking');
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URL(window.location.href).searchParams;
    const found = params.get('token');
    if (!found || params.get('error')) {
      setState('invalid');
      return;
    }
    setToken(found);
    setState('form');
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const problem = passwordProblem(password, repeat);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await authClient.resetPassword({ newPassword: password, token });
    setBusy(false);
    if (result.error) {
      if (result.error.code === 'INVALID_TOKEN') setState('invalid');
      else setError(resetProblem(result.error.code, result.error.message));
      return;
    }
    setState('done');
  }

  if (state === 'checking') {
    return (
      <AuthShell title="One moment">
        <p className="mt-7 text-sm text-muted">Checking the link…</p>
      </AuthShell>
    );
  }

  if (state === 'invalid') {
    return (
      <AuthShell
        title="That link has expired"
        hint="Reset links work for an hour and once only. Ask for a new one, or sign in with an emailed code."
      >
        <div className="mt-7 flex flex-col gap-3" data-testid="reset-invalid">
          <Link href="/forgot-password">
            <Button size="lg" className="w-full">
              Send me a new link
            </Button>
          </Link>
          <Link
            href="/sign-in"
            className="self-start text-[13px] text-muted underline underline-offset-2 hover:text-ink"
          >
            Sign in with a code instead
          </Link>
        </div>
      </AuthShell>
    );
  }

  if (state === 'done') {
    return (
      <AuthShell
        title="Your password is set"
        hint="Every other device has been signed out. Sign in with the new password — or with an emailed code, which still works."
      >
        <div className="mt-7" data-testid="reset-done">
          <Link href="/sign-in?mode=password">
            <Button size="lg" className="w-full">
              Sign in
            </Button>
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Choose a new password"
      hint={`At least ${PASSWORD_MIN_LENGTH} characters. A short sentence you will remember is ideal.`}
    >
      <form onSubmit={submit} className="mt-7 flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            autoFocus
            required
            minLength={PASSWORD_MIN_LENGTH}
            className="h-11"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            data-testid="reset-password"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="repeat">The same again</Label>
          <Input
            id="repeat"
            name="repeat"
            type="password"
            autoComplete="new-password"
            required
            className="h-11"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            data-testid="reset-repeat"
          />
          <Hint>Typing it twice catches a slip that would lock you out.</Hint>
        </div>
        <Button
          type="submit"
          size="lg"
          disabled={busy || password.length === 0 || repeat.length === 0}
          data-testid="reset-submit"
        >
          {busy ? 'Saving…' : 'Set the password'}
        </Button>
      </form>
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
