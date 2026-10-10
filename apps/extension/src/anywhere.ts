/**
 * "Show Save buttons on every site" — ADR-0154. Off unless the student turns it on in the popup.
 *
 * The manifest asks for no access to other sites at install (`optional_host_permissions` only,
 * so the install warning is what it was). The popup's switch asks Chrome for `https://*\/*` on
 * the student's press, and Chrome shows its own prompt; once granted, the service worker
 * registers the same content script the five sites have (`content.js`) for every https page, in
 * the top frame, at `document_idle`. Turning the switch off gives the access back
 * (`permissions.remove`) and the script is unregistered. `syncAnywhere` keeps the two in step on
 * every wake of the service worker and whenever Chrome says the access changed, so a student who
 * takes the access away at chrome://extensions loses the buttons too.
 *
 * Never on: the five sites that have the script already (it would run twice), this add-on's own
 * site, and Jenni's pages (`neverHere`).
 */

import { INPAGE_MATCHES } from './hosts.js';

/** What the switch asks Chrome for. */
export const ANYWHERE_ORIGINS = ['https://*/*'] as const;

/** The registered script's id (must not start with "_"). */
export const ANYWHERE_SCRIPT_ID = 'tc-anywhere';

/** Hosts the buttons never go on, whatever the switch says: Jenni's own pages. */
const NEVER_DOMAINS = ['jenni.ai'];

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

/** True for a host the buttons must never go on: ours, or Jenni's (and their subdomains). */
export function neverHere(hostname: string, own: readonly string[]): boolean {
  const host = hostname.toLowerCase();
  return [...own, ...NEVER_DOMAINS].some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}

/** The registration's `excludeMatches`: the five sites, our own site, Jenni's. */
export function anywhereExcludes(own: readonly string[]): string[] {
  return [
    ...INPAGE_MATCHES,
    ...own.flatMap((host) => [`https://${host}/*`, `https://*.${host}/*`]),
    ...NEVER_DOMAINS.flatMap((domain) => [`https://${domain}/*`, `https://*.${domain}/*`]),
  ];
}

/** The registration itself. */
export function anywhereScript(own: readonly string[]): chrome.scripting.RegisteredContentScript {
  return {
    id: ANYWHERE_SCRIPT_ID,
    matches: [...ANYWHERE_ORIGINS],
    excludeMatches: anywhereExcludes(own),
    js: ['content.js'],
    runAt: 'document_idle',
    allFrames: false,
    persistAcrossSessions: true,
  };
}

/** The parts of Chrome `syncAnywhere` uses, so it is tested with a fake. */
export type AnywhereChrome = {
  contains(permissions: chrome.permissions.Permissions): Promise<boolean>;
  registered(ids: string[]): Promise<Array<{ id: string }>>;
  register(scripts: chrome.scripting.RegisteredContentScript[]): Promise<void>;
  unregister(ids: string[]): Promise<void>;
};

/** True when the student has given the add-on every https site. */
export function anywhereGranted(api: Pick<AnywhereChrome, 'contains'>): Promise<boolean> {
  return api.contains({ origins: [...ANYWHERE_ORIGINS] }).catch(() => false);
}

/**
 * Registers the script when the access is there and it is not, and unregisters it when the
 * access is gone. Returns whether the buttons are now on.
 */
export async function syncAnywhere(api: AnywhereChrome, own: readonly string[]): Promise<boolean> {
  const granted = await anywhereGranted(api);
  let present = false;
  try {
    present = (await api.registered([ANYWHERE_SCRIPT_ID])).some((s) => s.id === ANYWHERE_SCRIPT_ID);
  } catch {
    present = false;
  }
  if (granted && !present) await api.register([anywhereScript(own)]);
  if (!granted && present) await api.unregister([ANYWHERE_SCRIPT_ID]);
  return granted;
}

/** Chrome's own functions, for the service worker. */
export const chromeAnywhere = (): AnywhereChrome => ({
  contains: (permissions) => chrome.permissions.contains(permissions),
  registered: (ids) => chrome.scripting.getRegisteredContentScripts({ ids }),
  register: (scripts) => chrome.scripting.registerContentScripts(scripts),
  unregister: (ids) => chrome.scripting.unregisterContentScripts({ ids }),
});
