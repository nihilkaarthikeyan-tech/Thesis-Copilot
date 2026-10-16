/**
 * Save buttons on every site — ADR-0154, changed by ADR-0156.
 *
 * Since 0.4.0 the access is taken at install, as the student's other reference tools do: the
 * manifest's `host_permissions` has `https://*\/*` and its second content script (the same
 * `content.js` the five sites have) runs on every https page, in the top frame, at
 * `document_idle`. What it does there is unchanged from 0.3.2: it reads the article tags
 * (`citation_doi`, `dc.identifier`, `prism.doi`, Highwire's `citation_title`) and the doi.org links
 * inside reference lists, and sends nothing until a press. The student turns the buttons off — for
 * every site or for one — in the add-on's settings (`settings.ts`), not by removing access.
 *
 * Never on: the five sites that have their own entry (it would run twice) and this add-on's own
 * site (`neverHere`, checked again in `content.ts` and `findSpots`).
 */

import { INPAGE_MATCHES } from './hosts.js';

/** Where the every-site content script runs, and the host access the manifest asks for. */
export const ANYWHERE_MATCHES = ['https://*/*'] as const;

/** The id 0.3.2 registered its every-site script under, removed on the update (ADR-0156). */
export const RETIRED_SCRIPT_ID = 'tc-anywhere';

/** The hosts of this add-on's own site (the build's API and web addresses). */
export function ownHosts(urls: readonly string[]): string[] {
  const hosts = new Set<string>();
  for (const url of urls) {
    try {
      hosts.add(new URL(url).hostname.toLowerCase());
    } catch {
      // Not an address.
    }
  }
  return [...hosts];
}

/** True for a host the buttons must never go on: this add-on's own site (and its subdomains). */
export function neverHere(hostname: string, own: readonly string[]): boolean {
  const host = hostname.toLowerCase();
  return own.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/** The every-site entry's `exclude_matches`: the five sites and our own site. */
export function anywhereExcludes(own: readonly string[]): string[] {
  return [
    ...INPAGE_MATCHES,
    ...own.flatMap((host) => [`https://${host}/*`, `https://*.${host}/*`]),
  ];
}

/** The parts of `chrome.scripting` `retireDynamicScript` uses, so it is tested with a fake. */
export type ScriptingApi = {
  registered(ids: string[]): Promise<Array<{ id: string }>>;
  unregister(ids: string[]): Promise<void>;
};

/**
 * 0.3.2 registered the every-site script at run time, and Chrome keeps such a registration across
 * an update. The manifest's entry replaces it, so it is removed once (the page flag in
 * `content.ts` would stop a second run anyway). True when there was one.
 */
export async function retireDynamicScript(api: ScriptingApi): Promise<boolean> {
  try {
    const found = await api.registered([RETIRED_SCRIPT_ID]);
    if (!found.some((script) => script.id === RETIRED_SCRIPT_ID)) return false;
    await api.unregister([RETIRED_SCRIPT_ID]);
    return true;
  } catch {
    return false;
  }
}

/** Chrome's own functions, for the service worker. */
export const chromeScripting = (): ScriptingApi => ({
  registered: (ids) => chrome.scripting.getRegisteredContentScripts({ ids }),
  unregister: (ids) => chrome.scripting.unregisterContentScripts({ ids }),
});
