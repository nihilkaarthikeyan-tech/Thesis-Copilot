'use client';

/**
 * The frame around the small account screens that live outside `/app` — forgot password and
 * reset password (ADR-0033). The same header as sign-in, one narrow column, no marketing.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { LogoMark } from '@/components/LogoMark';
import { ThemeToggle } from '@/components/theme';
import { Hint } from '@/components/ui/primitives';

export function AuthShell({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3.5">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-[17px] font-bold tracking-tight"
          >
            <LogoMark size={24} />
            Thesis Copilot
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/sign-in" className="text-[13px] text-muted hover:text-ink">
              Sign in
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-6 py-14">
        <div className="mx-auto w-full max-w-[24rem]">
          <h1 className="text-balance text-[30px] font-bold leading-tight tracking-[-0.02em]">
            {title}
          </h1>
          {hint ? <Hint className="mt-2 text-[14px]">{hint}</Hint> : null}
          {children}
        </div>
      </main>
    </div>
  );
}
