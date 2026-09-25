/**
 * Runs inside the student's tab, and only when they click the add-on (ADR-0031: `activeTab`, no
 * content script on every page). Chrome serialises this function into the page, so it must not
 * refer to anything outside itself — no imports, no module-level names.
 *
 * It returns the address, the title and the meta tags, and nothing of the page's text.
 */

import type { PageMeta } from './paper.js';

export function collectPageMeta(): PageMeta {
  const meta: Array<[string, string]> = [];
  for (const element of Array.from(document.querySelectorAll('meta'))) {
    const name =
      element.getAttribute('name') ??
      element.getAttribute('property') ??
      element.getAttribute('itemprop');
    const content = element.getAttribute('content');
    if (name && content) meta.push([name.trim().toLowerCase(), content.slice(0, 2_000)]);
    if (meta.length >= 500) break;
  }
  return { url: location.href, title: document.title.slice(0, 500), meta };
}
