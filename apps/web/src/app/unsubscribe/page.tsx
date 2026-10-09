'use client';

/**
 * `/unsubscribe?token=…` — the one-click link at the foot of a comment email (ADR-0142).
 *
 * No sign-in: the signed token names the account. Opening the page turns comment emails off at
 * once (the one click) and offers to undo it. It posts rather than the email linking to a GET
 * that changes state, because mail scanners fetch every link in a message.
 */

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '@/i18n/react';
import { api } from '@/lib/api';

type State = 'working' | 'off' | 'on' | 'invalid';

function Unsubscribe() {
  const { t } = useT();
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<State>('working');
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  const set = useCallback(
    async (on: boolean) => {
      setBusy(true);
      try {
        const result = await api<{ emailOnComments: boolean }>('/email/unsubscribe', {
          method: 'POST',
          body: JSON.stringify({ token, on }),
        });
        setState(result.emailOnComments ? 'on' : 'off');
      } catch {
        setState('invalid');
      } finally {
        setBusy(false);
      }
    },
    [token],
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!token) setState('invalid');
    else void set(false);
  }, [token, set]);

  return (
    <main className="mx-auto max-w-xl px-4 py-16 sm:px-6">
      <h1 className="text-balance text-[24px] font-bold leading-tight text-ink">
        {t('unsubscribe.title')}
      </h1>
      <p role="status" className="mt-4 text-sm" data-testid="unsubscribe-status">
        {state === 'working'
          ? t('unsubscribe.working')
          : state === 'off'
            ? t('unsubscribe.off')
            : state === 'on'
              ? t('unsubscribe.on')
              : t('unsubscribe.invalid')}
      </p>
      {state === 'off' || state === 'on' ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void set(state === 'off')}
          className="mt-4 rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:bg-sunk disabled:opacity-50"
        >
          {state === 'off' ? t('unsubscribe.undo') : t('unsubscribe.again')}
        </button>
      ) : null}
      <p className="mt-6 text-sm text-muted">
        {t('unsubscribe.account')}{' '}
        <Link href="/app/account" className="underline">
          Account
        </Link>
      </p>
    </main>
  );
}

export default function UnsubscribePage() {
  return (
    <Suspense fallback={null}>
      <Unsubscribe />
    </Suspense>
  );
}
