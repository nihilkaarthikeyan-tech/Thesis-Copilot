/**
 * ADR-0156, add-on 0.4.0: the in-page Save buttons are on everywhere from install, and the student
 * turns them off — for every site, or for one — in the add-on's settings; and the theme setting.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INLINE,
  type Follower,
  followSettings,
  inlineOn,
  MAX_OFF_SITES,
  readInline,
  readTheme,
  siteKey,
  type Theme,
  withAll,
  withSite,
} from '../src/settings.js';

describe('the Save buttons setting', () => {
  it('is on for every site when nothing was ever stored (a fresh install)', () => {
    expect(readInline(undefined)).toEqual(DEFAULT_INLINE);
    expect(inlineOn(readInline(undefined), 'www.mdpi.com')).toBe(true);
    expect(inlineOn(readInline(null), 'en.wikipedia.org')).toBe(true);
    // Anything malformed reads as on, never as off.
    expect(readInline({ all: 'no', offSites: 'x' })).toEqual({ all: true, offSites: [] });
  });

  it('off everywhere turns every site off; on again restores the per-site choices', () => {
    const off = withAll(withSite(DEFAULT_INLINE, 'example.org', false), false);
    expect(inlineOn(off, 'en.wikipedia.org')).toBe(false);
    const on = withAll(off, true);
    expect(inlineOn(on, 'en.wikipedia.org')).toBe(true);
    expect(inlineOn(on, 'example.org')).toBe(false);
  });

  it('one site off: that site (and its www.) only', () => {
    const settings = withSite(DEFAULT_INLINE, 'www.Example.org', false);
    expect(settings.offSites).toEqual(['example.org']);
    expect(inlineOn(settings, 'example.org')).toBe(false);
    expect(inlineOn(settings, 'www.example.org')).toBe(false);
    expect(inlineOn(settings, 'journals.example.org')).toBe(true);
    expect(inlineOn(withSite(settings, 'example.org', true), 'www.example.org')).toBe(true);
    // Turning the same site off twice keeps one entry.
    expect(withSite(settings, 'example.org', false).offSites).toEqual(['example.org']);
  });

  it('keys a site by its host without www., in lower case', () => {
    expect(siteKey('WWW.MDPI.com')).toBe('mdpi.com');
    expect(siteKey('pubmed.ncbi.nlm.nih.gov.')).toBe('pubmed.ncbi.nlm.nih.gov');
  });

  it('keeps at most MAX_OFF_SITES, the newest choices', () => {
    let settings = DEFAULT_INLINE;
    for (let i = 0; i < MAX_OFF_SITES + 5; i += 1)
      settings = withSite(settings, `s${i}.org`, false);
    expect(settings.offSites).toHaveLength(MAX_OFF_SITES);
    expect(settings.offSites.at(-1)).toBe(`s${MAX_OFF_SITES + 4}.org`);
    expect(readInline({ offSites: settings.offSites.concat(['x.org']) }).offSites).toHaveLength(
      MAX_OFF_SITES,
    );
  });

  it('reads the theme, system unless light or dark was chosen', () => {
    expect(readTheme(undefined)).toBe('system');
    expect(readTheme('dark')).toBe('dark');
    expect(readTheme('light')).toBe('light');
    expect(readTheme('blue')).toBe('system');
  });
});

describe('a page follows the setting', () => {
  function page(stored: { inline?: unknown; theme?: unknown }, hostname = 'en.wikipedia.org') {
    const log: string[] = [];
    let listener: ((change: { inline?: unknown; theme?: unknown }) => void) | null = null;
    const follower: Follower = {
      hostname,
      read: async () => ({ inline: stored.inline, theme: stored.theme }),
      onChange: (l) => {
        listener = l;
      },
      start: () => {
        log.push('start');
        return { stop: () => log.push('stop') };
      },
      remove: () => log.push('remove'),
      theme: (t: Theme) => log.push(`theme ${t}`),
    };
    return {
      log,
      follower,
      change: (c: { inline?: unknown; theme?: unknown }) => listener?.(c),
    };
  }

  it('starts the buttons on a fresh install, with the system theme', async () => {
    const p = page({});
    await followSettings(p.follower);
    expect(p.log).toEqual(['theme system', 'start']);
  });

  it('never starts them on a site turned off, or with every site off', async () => {
    const site = page({ inline: { all: true, offSites: ['wikipedia.org'] } }, 'wikipedia.org');
    await followSettings(site.follower);
    expect(site.log).not.toContain('start');
    const all = page({ inline: { all: false, offSites: [] } });
    await followSettings(all.follower);
    expect(all.log).not.toContain('start');
  });

  it('takes them out when turned off, and puts them back when turned on — no reload', async () => {
    const p = page({});
    await followSettings(p.follower);
    p.change({ inline: { all: true, offSites: ['en.wikipedia.org'] } });
    expect(p.log.slice(-2)).toEqual(['stop', 'remove']);
    p.change({ inline: { all: true, offSites: [] } });
    expect(p.log.at(-1)).toBe('start');
    p.change({ theme: 'dark' });
    expect(p.log.at(-1)).toBe('theme dark');
    // Another site's choice changes nothing here.
    const before = p.log.length;
    p.change({ inline: { all: true, offSites: ['example.org'] } });
    expect(p.log).toHaveLength(before);
  });

  it('unreadable storage: on, as on a fresh install', async () => {
    const p = page({});
    p.follower.read = async () => {
      throw new Error('storage gone');
    };
    await followSettings(p.follower);
    expect(p.log).toContain('start');
  });
});
