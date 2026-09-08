import type { Metadata } from 'next';
import { Source_Sans_3, Spectral } from 'next/font/google';
import type { ReactNode } from 'react';
import { ThemeScript } from '@/components/theme';
import './globals.css';

/**
 * Paper & Ink pairs a serif for prose with a sans for the interface (docs/DESIGN.md).
 *
 * Spectral is the writing face: it is what the student's own thesis is set in, so the editor reads
 * like a manuscript rather than a form. Source Sans 3 carries the chrome — menus, labels, meters —
 * and never appears inside the writing column.
 */
const spectral = Spectral({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-spectral',
  display: 'swap',
});

const sourceSans = Source_Sans_3({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-source-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'Thesis Copilot', template: '%s · Thesis Copilot' },
  description: 'An editor for university theses that only cites what it can show you.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${spectral.variable} ${sourceSans.variable}`}
      suppressHydrationWarning
    >
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
