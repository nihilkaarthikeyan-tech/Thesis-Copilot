import { Check } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ThemeToggle } from '@/components/theme';
import { cn } from '@/lib/utils';
import { Brand } from './Brand';
import { satoshi } from './fonts';
import './marketing.css';

/**
 * The sign-in and sign-up frame (landing round 7): the form on the left, a photograph on the
 * right with one card that says something true about the product. On a narrow screen the
 * photograph is dropped rather than stacked, so a phone gets straight to the field.
 */
export function AuthFrame({
  photo,
  photoAlt,
  cardTitle,
  cardBody,
  cardPoints,
  children,
}: {
  photo: string;
  photoAlt: string;
  cardTitle: string;
  cardBody: string;
  cardPoints: readonly string[];
  children: ReactNode;
}) {
  return (
    <div className={cn('mk mk-auth', satoshi.variable)}>
      <div className="mk-auth-form">
        <div className="mk-auth-top">
          <Brand />
          <nav aria-label="Site">
            <Link href="/pricing">Pricing</Link>
            <ThemeToggle />
          </nav>
        </div>
        <main className="mk-auth-box">{children}</main>
      </div>
      <aside className="mk-auth-visual" aria-label="About Thesis Copilot">
        {/* biome-ignore lint/performance/noImgElement: pre-sized WebP in public/; the standalone image runs no image optimiser. */}
        <img src={photo} alt={photoAlt} width={1300} height={900} />
        <div className="mk-auth-card">
          <b>{cardTitle}</b>
          <p>{cardBody}</p>
          <ul>
            {cardPoints.map((point) => (
              <li key={point}>
                <Check aria-hidden="true" strokeWidth={2.5} />
                {point}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
