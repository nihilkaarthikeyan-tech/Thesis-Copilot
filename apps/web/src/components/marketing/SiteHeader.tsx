'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ThemeToggle } from '@/components/theme';
import { useSession } from '@/lib/auth-client';
import { Brand } from './Brand';

/**
 * The landing page's sticky header. Transparent over the hero; once the page has scrolled, a
 * hairline appears under it so it reads as separate from the content passing beneath.
 *
 * A signed-in visitor is offered their theses, not a sign-up (docs/JENNI-STUDENT-JOURNEY.md step
 * 0). The session is read client-side after first paint, so a signed-out visitor — the page's
 * real audience — sees the header at once and never waits on the API; the button changes only
 * once a session is confirmed.
 */
export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const session = useSession();
  const signedIn = Boolean(session.data?.user);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className="mk-nav" data-scrolled={scrolled}>
      <div className="mk-wrap mk-nav-row">
        <Brand />
        <nav className="mk-nav-links" aria-label="On this page">
          <a href="#tour">How it works</a>
          <a href="#guides" className="mk-nav-minor">
            For guides
          </a>
          <a href="#pricing">Pricing</a>
          <a href="#faq" className="mk-nav-minor">
            Questions
          </a>
        </nav>
        <div className="mk-nav-end">
          <ThemeToggle />
          {signedIn ? (
            <Link
              href="/app"
              className="mk-btn mk-btn-primary mk-btn-sm"
              data-testid="header-go-to-theses"
            >
              Go to your theses
            </Link>
          ) : (
            <>
              <Link href="/sign-in" className="mk-signin">
                Sign in
              </Link>
              <Link href="/sign-up" className="mk-btn mk-btn-primary mk-btn-sm">
                Start writing free
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
