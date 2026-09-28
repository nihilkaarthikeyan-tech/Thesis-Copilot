import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/site';

/**
 * The web app manifest — what Android uses when a student adds the site to their home screen.
 * The icons are the logo (components/LogoMark.tsx), rendered to PNG; the maskable one keeps the
 * T inside the safe zone so a round launcher does not clip it.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE.name,
    short_name: SITE.name,
    description: SITE.tagline,
    start_url: '/app',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#0f1724',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
