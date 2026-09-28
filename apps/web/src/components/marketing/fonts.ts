import localFont from 'next/font/local';

/**
 * Satoshi, the typeface of the public pages (landing round 7, 2026-09-28).
 *
 * Self-hosted from Fontshare under the ITF Free Font License, which allows commercial use on a
 * website. Served from our own origin so a visitor's first page view makes no request to a third
 * party. Used only inside `.mk` (marketing.css); the product keeps Source Sans 3 and Spectral.
 */
export const satoshi = localFont({
  src: [
    { path: './fonts/Satoshi-Regular.woff2', weight: '400', style: 'normal' },
    { path: './fonts/Satoshi-Medium.woff2', weight: '500', style: 'normal' },
    { path: './fonts/Satoshi-Bold.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-satoshi',
  display: 'swap',
});
