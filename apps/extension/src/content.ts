/**
 * The content script — ADR-0125. Chrome runs it on the pages in `hosts.ts` and, since 0.4.0, on
 * every other https page (ADR-0156, `manifest.ts`), in the top frame, once the page has loaded.
 * Unless the student turned the buttons off (everywhere, or for this site) it puts the
 * "Save to Thesis Copilot" buttons in (`inpage.ts`) and passes the card's requests to the service
 * worker, which alone talks to Thesis Copilot. It makes no request of its own, to the site or to
 * anywhere else.
 *
 * Chrome loads a content script as a classic script, not a module, so `scripts/build.mjs` joins
 * this file and what it imports into one readable `content.js` (esbuild, not minified).
 */

import { neverHere, ownHosts } from './anywhere.js';
import { API_URL, INPAGE_SHADOW, WEB_URL } from './config.js';
import { removeInpage, setInpageTheme, startInpage } from './inpage.js';
import type { Reply, Request } from './messages.js';
import { followSettings, INLINE_KEY, THEME_KEY } from './settings.js';

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

// ADR-0154/0156: the same file runs on the five sites and on every other https page. Once per
// page (the two manifest entries exclude each other, and this makes sure of it), never on this
// add-on's own site, and only while the student has the buttons on for this site (`settings.ts`).
const flag = globalThis as { __thesisCopilotInpage?: boolean };
if (!flag.__thesisCopilotInpage && !neverHere(location.hostname, ownHosts([API_URL, WEB_URL]))) {
  flag.__thesisCopilotInpage = true;
  void followSettings({
    hostname: location.hostname,
    read: async () => {
      const stored = await chrome.storage.local.get([INLINE_KEY, THEME_KEY]);
      return { inline: stored[INLINE_KEY], theme: stored[THEME_KEY] };
    },
    onChange: (listener) =>
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        const change: { inline?: unknown; theme?: unknown } = {};
        if (INLINE_KEY in changes) change.inline = changes[INLINE_KEY]?.newValue;
        if (THEME_KEY in changes) change.theme = changes[THEME_KEY]?.newValue;
        if (Object.keys(change).length) listener(change);
      }),
    start: () =>
      startInpage({
        ask,
        storage: {
          get: (keys) => chrome.storage.local.get(keys),
          set: (values) => chrome.storage.local.set(values),
        },
        webUrl: WEB_URL,
        mode: INPAGE_SHADOW,
      }),
    remove: removeInpage,
    theme: setInpageTheme,
  });
}
