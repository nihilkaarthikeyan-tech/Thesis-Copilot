/**
 * The add-on's two settings — ADR-0156. Both live in `chrome.storage.local`, in this browser only,
 * and are never sent anywhere.
 *
 * - **The in-page Save buttons** are on for every site from install (the manifest's content script
 *   runs on every https page). The student can turn them off everywhere, or for one site only; the
 *   per-site choice is a list of the hosts turned off (`www.` dropped, so a site and its `www.`
 *   are one choice).
 * - **The theme**: follow the system, or always light, or always dark — for the add-on's window
 *   and its buttons and card in pages.
 *
 * Pure: `content.ts` and `popup.ts` pass in `chrome.storage`; the tests pass a fake.
 */

export const INLINE_KEY = 'inlineButtons';
export const THEME_KEY = 'theme';

/** At most this many sites turned off; the oldest choice goes first past it. */
export const MAX_OFF_SITES = 500;

export type InlineSettings = {
  /** False: no Save buttons in any page. */
  all: boolean;
  /** The sites whose Save buttons the student turned off (see `siteKey`). */
  offSites: string[];
};

export type Theme = 'system' | 'light' | 'dark';

export const DEFAULT_INLINE: InlineSettings = { all: true, offSites: [] };

/** One site, as the per-site switch keys it: lower case, without a leading `www.`. */
export function siteKey(hostname: string): string {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^www\./, '');
}

/** What was stored, checked; anything missing or malformed reads as the default (on). */
export function readInline(stored: unknown): InlineSettings {
  if (!stored || typeof stored !== 'object') return { ...DEFAULT_INLINE, offSites: [] };
  const value = stored as { all?: unknown; offSites?: unknown };
  const offSites = Array.isArray(value.offSites)
    ? [
        ...new Set(
          value.offSites
            .filter((site): site is string => typeof site === 'string' && site.length > 0)
            .map(siteKey),
        ),
      ].slice(-MAX_OFF_SITES)
    : [];
  return { all: value.all !== false, offSites };
}

/** True when the buttons go into a page on this host. */
export function inlineOn(settings: InlineSettings, hostname: string): boolean {
  return settings.all && !settings.offSites.includes(siteKey(hostname));
}

/** The settings with every site switched on or off. */
export function withAll(settings: InlineSettings, all: boolean): InlineSettings {
  return { ...settings, all };
}

/** The settings with one site switched on or off. */
export function withSite(settings: InlineSettings, hostname: string, on: boolean): InlineSettings {
  const key = siteKey(hostname);
  if (!key) return settings;
  const rest = settings.offSites.filter((site) => site !== key);
  return { ...settings, offSites: on ? rest : [...rest, key].slice(-MAX_OFF_SITES) };
}

export function readTheme(stored: unknown): Theme {
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

/**
 * Keeps the buttons in a page in step with the setting: started when the page loads if they are
 * on for its host, taken out when the student turns them off (everywhere or for this site), and
 * put back when they turn them on again — without a reload.
 */
export type Follower = {
  read(): Promise<{ inline: unknown; theme: unknown }>;
  /** Called with the new values whenever either setting changes. */
  onChange(listener: (change: { inline?: unknown; theme?: unknown }) => void): void;
  hostname: string;
  start(): { stop(): void };
  /** Takes every button and the card out of the page. */
  remove(): void;
  theme(theme: Theme): void;
};

export async function followSettings(follower: Follower): Promise<void> {
  let running: { stop(): void } | null = null;
  let inline = DEFAULT_INLINE;
  const apply = () => {
    const on = inlineOn(inline, follower.hostname);
    if (on && !running) running = follower.start();
    if (!on && running) {
      running.stop();
      running = null;
      follower.remove();
    }
  };
  let stored: { inline: unknown; theme: unknown } = { inline: undefined, theme: undefined };
  try {
    stored = await follower.read();
  } catch {
    // Unreadable storage: the defaults (on, the system's theme).
  }
  inline = readInline(stored.inline);
  follower.theme(readTheme(stored.theme));
  follower.onChange((change) => {
    if ('theme' in change) follower.theme(readTheme(change.theme));
    if ('inline' in change) {
      inline = readInline(change.inline);
      apply();
    }
  });
  apply();
}
