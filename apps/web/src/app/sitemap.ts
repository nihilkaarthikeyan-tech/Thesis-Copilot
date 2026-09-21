/**
 * The public pages, so a crawler does not have to guess.
 *
 * Only the four marketing routes. There is nothing else on this site a stranger should be led to:
 * everything a student writes is behind a session, and a sitemap entry for a sign-in form is an
 * invitation to a dead end.
 *
 * `lastModified` is the deploy time rather than a hardcoded date — wrong enough to be honest
 * (the copy did not necessarily change) and never stale, which is the failure mode that makes a
 * crawler stop trusting the file.
 */

import type { MetadataRoute } from 'next';
import { PUBLIC_ROUTES, SITE_URL } from '@/lib/site';

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return PUBLIC_ROUTES.map((route) => ({
    url: `${SITE_URL}${route === '/' ? '' : route}`,
    lastModified,
    changeFrequency: route === '/' ? ('weekly' as const) : ('monthly' as const),
    priority: route === '/' ? 1 : 0.7,
  }));
}
