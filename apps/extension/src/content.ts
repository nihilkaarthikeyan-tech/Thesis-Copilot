/**
 * The content script — ADR-0125. Chrome runs it on the pages in `hosts.ts` only (the manifest's
 * `content_scripts.matches`), in the top frame, once the page has loaded. It puts the
 * "Add to Thesis Copilot" buttons in (`inpage.ts`) and passes the card's requests to the service
 * worker, which alone talks to Thesis Copilot. It makes no request of its own, to the site or to
 * anywhere else.
 *
 * Chrome loads a content script as a classic script, not a module, so `scripts/build.mjs` joins
 * this file and what it imports into one readable `content.js` (esbuild, not minified).
 */

import { INPAGE_SHADOW, WEB_URL } from './config.js';
import { startInpage } from './inpage.js';
import type { Reply, Request } from './messages.js';

/** Why the service worker did not answer, in words the student can act on. */
function unanswered(error: unknown): Reply<never> {
  const updated = /context invalidated/i.test(String(error));
  return {
    ok: false,
    status: 0,
    message: updated
      ? 'Thesis Copilot was updated. Reload this page to use it.'
      : 'The add-on did not answer. Reload this page and try again.',
  };
}

async function ask<T>(request: Request): Promise<Reply<T>> {
  try {
    const reply = (await chrome.runtime.sendMessage(request)) as Reply<T> | undefined;
    return reply ?? unanswered(null);
  } catch (error) {
    return unanswered(error);
  }
}

startInpage({
  ask,
  storage: {
    get: (keys) => chrome.storage.local.get(keys),
    set: (values) => chrome.storage.local.set(values),
  },
  webUrl: WEB_URL,
  mode: INPAGE_SHADOW,
});
