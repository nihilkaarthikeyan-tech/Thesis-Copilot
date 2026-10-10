/**
 * The content script — ADR-0125. Chrome runs it on the pages in `hosts.ts` (the manifest's
 * `content_scripts.matches`) and, only while the student has "Show Save buttons on every site"
 * on, on other https pages too (ADR-0154, registered by `anywhere.ts`), in the top frame, once
 * the page has loaded. It puts the
 * "Add to Thesis Copilot" buttons in (`inpage.ts`) and passes the card's requests to the service
 * worker, which alone talks to Thesis Copilot. It makes no request of its own, to the site or to
 * anywhere else.
 *
 * Chrome loads a content script as a classic script, not a module, so `scripts/build.mjs` joins
 * this file and what it imports into one readable `content.js` (esbuild, not minified).
 */

import { neverHere, ownHosts } from './anywhere.js';
import { API_URL, INPAGE_SHADOW, WEB_URL } from './config.js';
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

// ADR-0154: the same file also runs on every site when the student turns that on. Once per page
// (the two registrations exclude each other, and this makes sure of it), and never on this
// add-on's own site or on Jenni's pages.
const flag = globalThis as { __thesisCopilotInpage?: boolean };
if (!flag.__thesisCopilotInpage && !neverHere(location.hostname, ownHosts([API_URL, WEB_URL]))) {
  flag.__thesisCopilotInpage = true;
  startInpage({
    ask,
    storage: {
      get: (keys) => chrome.storage.local.get(keys),
      set: (values) => chrome.storage.local.set(values),
    },
    webUrl: WEB_URL,
    mode: INPAGE_SHADOW,
  });
}
