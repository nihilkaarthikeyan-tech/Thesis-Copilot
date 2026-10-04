import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/**
 * ADR-0057: a "can read" link. Never indexed, and never sent onward as a referrer — the token is
 * in the URL, and a link clicked from here must not hand it to the next site.
 */
export const metadata: Metadata = {
  title: 'Shared thesis',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function ReadLayout({ children }: { children: ReactNode }) {
  return children;
}
