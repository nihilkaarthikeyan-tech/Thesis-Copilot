'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ThemeToggle } from '@/components/theme';
import { Brand } from './Brand';

/**
 * The landing page's sticky header. Transparent over the hero; once the page has scrolled, a
 * hairline appears under it so it reads as separate from the content passing beneath.
 */
export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);

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
          <a href="#guides">For guides</a>
          <a href="#pricing">Pricing</a>
          <a href="#faq">Questions</a>
        </nav>
        <div className="mk-nav-end">
          <ThemeToggle />
          <Link href="/sign-in" className="mk-signin">
            Sign in
          </Link>
          <Link href="/sign-up" className="mk-btn mk-btn-primary mk-btn-sm">
            Start writing free
          </Link>
        </div>
      </div>
    </header>
  );
}
