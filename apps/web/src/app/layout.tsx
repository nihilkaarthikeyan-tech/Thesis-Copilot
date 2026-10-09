import type { Metadata } from 'next';
import localFont from 'next/font/local';
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
// 2026-10-09: the three Google fonts are self-hosted from @fontsource (SIL OFL), as Satoshi already
// was. `next/font/google` fetched them from fonts.googleapis.com at build time, and a slow answer
// failed two CI builds in one day; the release build is the same build.
const spectral = localFont({
  src: [
    {
      path: '../../node_modules/@fontsource/spectral/files/spectral-latin-400-normal.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: '../../node_modules/@fontsource/spectral/files/spectral-latin-400-italic.woff2',
      weight: '400',
      style: 'italic',
    },
    {
      path: '../../node_modules/@fontsource/spectral/files/spectral-latin-500-normal.woff2',
      weight: '500',
      style: 'normal',
    },
    {
      path: '../../node_modules/@fontsource/spectral/files/spectral-latin-500-italic.woff2',
      weight: '500',
      style: 'italic',
    },
    {
      path: '../../node_modules/@fontsource/spectral/files/spectral-latin-600-normal.woff2',
      weight: '600',
      style: 'normal',
    },
    {
      path: '../../node_modules/@fontsource/spectral/files/spectral-latin-600-italic.woff2',
      weight: '600',
      style: 'italic',
    },
  ],
  variable: '--font-spectral',
  display: 'swap',
});

/**
 * Inter for the dark theme (ADR-0090, Jenni build plan R41): the owner chose Jenni's warm dark
 * with Inter for every screen and the thesis text; light keeps Satoshi and Spectral. Not
 * preloaded, so a light page does not download it.
 */
const inter = localFont({
  src: [
    {
      path: '../../node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: '../../node_modules/@fontsource/inter/files/inter-latin-500-normal.woff2',
      weight: '500',
      style: 'normal',
    },
    {
      path: '../../node_modules/@fontsource/inter/files/inter-latin-600-normal.woff2',
      weight: '600',
      style: 'normal',
    },
    {
      path: '../../node_modules/@fontsource/inter/files/inter-latin-700-normal.woff2',
      weight: '700',
      style: 'normal',
    },
  ],
  variable: '--font-inter',
  display: 'swap',
  preload: false,
});

/**
 * Devanagari for the Hindi interface (ADR-0061). Satoshi has no Devanagari glyphs, and the
 * system fallback on many Windows and Android machines draws matras badly. Only referenced from
 * `html[lang="hi"]` in globals.css, and not preloaded, so an English page never downloads it.
 */
const devanagari = localFont({
  src: [
    {
      path: '../../node_modules/@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-400-normal.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: '../../node_modules/@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-500-normal.woff2',
      weight: '500',
      style: 'normal',
    },
    {
      path: '../../node_modules/@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-700-normal.woff2',
      weight: '700',
      style: 'normal',
    },
  ],
  variable: '--font-devanagari',
  display: 'swap',
  preload: false,
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
    <html
      lang="en"
      className={`${spectral.variable} ${satoshi.variable} ${devanagari.variable} ${inter.variable}`}
      suppressHydrationWarning
    >
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
