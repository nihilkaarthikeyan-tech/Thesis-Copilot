'use client';

/**
 * Every admin screen's frame (2026-09-29, the owner's approved design): a sidebar with the
 * sections, the two counts that need attention (failed jobs, unread feedback), and who is signed
 * in. The sign-in check lives here once instead of on every page: a signed-out visitor goes to
 * sign in and comes back, a student is told plainly the screens are not theirs.
 */

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { LogoMark } from '@/components/LogoMark';
import { useAdminGate } from '@/lib/admin-gate';
import { api } from '@/lib/api';
import { signOut } from '@/lib/auth-client';
import { cn } from '@/lib/utils';

type Badges = { failedJobs: number; unreadFeedback: number; pendingPitfalls?: number };

const SECTIONS: Array<{ href: string; label: string; badge?: keyof Badges }> = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/activity', label: 'Activity log' },
  { href: '/admin/jobs', label: 'Background jobs', badge: 'failedJobs' },
  { href: '/admin/feedback', label: 'Feedback', badge: 'unreadFeedback' },
  { href: '/admin/pitfalls', label: 'Pitfall bank', badge: 'pendingPitfalls' },
  { href: '/admin/settings', label: 'Settings' },
];

const SETTINGS: Array<{ href: string; label: string }> = [
  { href: '/admin/settings#costs', label: 'AI costs & budget' },
  { href: '/admin/settings#switches', label: 'Feature switches' },
  { href: '/admin/settings#plans', label: 'Plans' },
];

function isCurrent(pathname: string, href: string): boolean {
  if (href === '/admin') return pathname === '/admin';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  const gate = useAdminGate();
  const pathname = usePathname() ?? '/admin';
  const router = useRouter();
  const [badges, setBadges] = useState<Badges | null>(null);

  // Refreshed on every move between sections, so a retried job or a read message clears its count.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the refresh trigger
  useEffect(() => {
    if (gate.state !== 'admin') return;
    api<Badges>('/admin/badges')
      .then(setBadges)
      .catch(() => undefined);
  }, [gate.state, pathname]);

  if (gate.state === 'loading' || gate.state === 'anonymous') {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-sm text-muted sm:px-6">
        Checking who you are…
      </main>
    );
  }

  if (gate.state === 'not-admin') {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <Link href="/" className="inline-flex items-center gap-2 text-[16px] font-bold">
          <LogoMark size={22} />
          Thesis Copilot
        </Link>
        <p className="mt-6 text-sm text-muted" data-testid="admin-not-admin">
          You are signed in as {gate.signedInAs ?? 'a student'}, which is not an administrator’s
          account. These screens are for administrators;{' '}
          <Link href="/app" className="underline">
            your theses
          </Link>{' '}
          are this way.
        </p>
      </main>
    );
  }

  const settingsOpen = isCurrent(pathname, '/admin/settings');

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="border-b border-line bg-surface lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-2 px-4 py-3 lg:px-5 lg:py-5">
          <Link href="/admin" className="inline-flex items-center gap-2 text-[15px] font-bold">
            <LogoMark size={22} />
            Thesis Copilot
          </Link>
          <span className="rounded-sm bg-accent-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-accent">
            Admin
          </span>
        </div>

        <nav
          aria-label="Admin sections"
          className="flex gap-1 overflow-x-auto px-3 pb-2 lg:flex-1 lg:flex-col lg:overflow-visible lg:px-3 lg:pb-0"
        >
          {SECTIONS.map((section) => {
            const current = isCurrent(pathname, section.href);
            const count = (section.badge && badges ? badges[section.badge] : 0) ?? 0;
            return (
              <div key={section.href} className="shrink-0">
                <Link
                  href={section.href}
                  aria-current={current ? 'page' : undefined}
                  className={cn(
                    'flex items-center justify-between gap-3 whitespace-nowrap rounded-md px-3 py-2 text-[13.5px] font-semibold transition-colors',
                    current
                      ? 'bg-accent-soft text-accent'
                      : 'text-muted hover:bg-sunk hover:text-ink',
                  )}
                >
                  {section.label}
                  {count > 0 ? (
                    <span
                      className="tnum rounded-full bg-danger px-1.5 text-[11px] font-bold text-paper"
                      data-testid={`admin-badge-${section.badge}`}
                    >
                      {count}
                    </span>
                  ) : null}
                </Link>
                {section.href === '/admin/settings' && settingsOpen ? (
                  <div className="hidden lg:mt-1 lg:mb-2 lg:block lg:space-y-0.5 lg:pl-3">
                    {SETTINGS.map((s) => (
                      <Link
                        key={s.href}
                        href={s.href}
                        className="block rounded-md px-3 py-1.5 text-[12.5px] text-muted hover:bg-sunk hover:text-ink"
                      >
                        {s.label}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>

        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-4 py-3 text-xs lg:block lg:px-5 lg:py-4"
          data-testid="admin-nav"
        >
          <p className="min-w-0 truncate font-semibold text-ink" data-testid="admin-signed-in">
            <span className="sr-only">Signed in as </span>
            {gate.signedInAs}
          </p>
          <p className="text-muted lg:mt-1">
            Super admin ·{' '}
            <Link href="/app/account" className="underline hover:text-ink">
              Account
            </Link>{' '}
            ·{' '}
            <button
              type="button"
              className="underline hover:text-ink"
              onClick={() => signOut().then(() => router.replace('/sign-in'))}
            >
              Sign out
            </button>
          </p>
        </div>
      </aside>

      <div className="min-w-0">{children}</div>
    </div>
  );
}
