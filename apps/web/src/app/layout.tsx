import type { Metadata } from 'next';
import { Spectral } from 'next/font/google';
import type { ReactNode } from 'react';
import { satoshi } from '@/components/marketing/fonts';
import { ThemeScript } from '@/components/theme';
import { SITE, SITE_URL } from '@/lib/site';
import './globals.css';

/**
 * One typeface system for the whole product (2026-09-28): the public pages and the app used to
 * look like two different products — Satoshi and cobalt outside, Source Sans and slate inside.
 *
 * Satoshi carries every screen: headings, menus, labels, meters. Spectral is kept for one job
 * only, the student's own writing — the editor's page, a chapter a guide reads, a quoted passage —
 * so a thesis still reads like a manuscript and never like a form.
 */
const spectral = Spectral({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-spectral',
  display: 'swap',
});

export const metadata: Metadata = {
  // A canonical origin so the same page under a preview domain does not compete with itself,
  // and so relative URLs below resolve (GEO/AEO — see lib/site.ts).
  metadataBase: new URL(SITE_URL),
  title: { default: SITE.name, template: `%s · ${SITE.name}` },
  description: SITE.tagline,
  applicationName: SITE.name,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: SITE.name,
    title: SITE.name,
    description: SITE.tagline,
    url: '/',
    locale: 'en_IN',
  },
  twitter: { card: 'summary_large_image', title: SITE.name, description: SITE.tagline },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${spectral.variable} ${satoshi.variable}`} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
