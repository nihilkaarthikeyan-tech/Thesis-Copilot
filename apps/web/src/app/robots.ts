/**
 * Who may crawl what — the first half of being quotable by an answer engine.
 *
 * ## The decision worth stating
 *
 * The AI crawlers are **allowed**, and that is a choice rather than a default. `GPTBot`,
 * `PerplexityBot`, `ClaudeBot` and `Google-Extended` are how a model comes to know this product
 * exists; blocking them is the correct call for a publisher whose words are the product, and the
 * wrong one for a tool whose marketing pages exist to be found.
 *
 * What they are allowed to read is only the marketing site. Everything a student writes lives
 * behind `/app` and a session cookie, so no crawler could reach it whatever this file said — the
 * `disallow` list is belt and braces, and documentation of intent.
 *
 * `/sign-in` and `/sign-up` are excluded for a different reason: they are not answers to
 * anything, and a search result landing someone on a sign-in form is a worse outcome than not
 * appearing at all.
 */

import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

/** Nothing here is secret; it is where the product's own data lives, and it needs a session. */
const PRIVATE = [
  '/app/',
  '/admin/',
  '/institution/',
  '/guide/',
  // ADR-0057: a "can read" link. The page also says noindex; this says it before the fetch.
  '/read/',
  '/sign-in',
  '/sign-up',
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: PRIVATE },
      // Named explicitly so the intent survives a future tightening of the wildcard rule.
      { userAgent: 'GPTBot', allow: '/', disallow: PRIVATE },
      { userAgent: 'OAI-SearchBot', allow: '/', disallow: PRIVATE },
      { userAgent: 'ChatGPT-User', allow: '/', disallow: PRIVATE },
      { userAgent: 'PerplexityBot', allow: '/', disallow: PRIVATE },
      { userAgent: 'ClaudeBot', allow: '/', disallow: PRIVATE },
      { userAgent: 'Google-Extended', allow: '/', disallow: PRIVATE },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
