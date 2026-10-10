/**
 * Where the in-page buttons run, and who the service worker answers (ADR-0125). Pinned: the
 * content script's pages are a short fixed list of https hosts — no `<all_urls>`, no wildcard
 * host — and a content script may ask only for theses, collections, a lookup and one save, and
 * only from a tab on one of those hosts; the popup may ask anything.
 */

import { describe, expect, it } from 'vitest';
import { INPAGE_HOSTS, INPAGE_MATCHES, isInpageUrl, senderMay } from '../src/hosts.js';
import { INPAGE_REQUESTS } from '../src/messages.js';

const OWN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/';

describe('the pages the buttons are put on', () => {
  it('are a fixed list of https hosts, none of them a wildcard', () => {
    expect(INPAGE_HOSTS).toEqual([
      'scholar.google.com',
      'scholar.google.co.in',
      'pubmed.ncbi.nlm.nih.gov',
      'arxiv.org',
      'www.mdpi.com',
    ]);
    for (const pattern of INPAGE_MATCHES) {
      expect(pattern.startsWith('https://')).toBe(true);
      expect(pattern).not.toContain('<all_urls>');
      expect(new URL(pattern.replace('*', '')).hostname).not.toContain('*');
    }
    // Scholar's results only, not every Google page.
    expect(INPAGE_MATCHES.filter((p) => p.includes('google'))).toEqual([
      'https://scholar.google.com/scholar*',
      'https://scholar.google.co.in/scholar*',
    ]);
  });

  it('are recognised by address', () => {
    expect(isInpageUrl('https://arxiv.org/abs/2610.00001')).toBe(true);
    expect(isInpageUrl('https://www.mdpi.com/1660-0000/14/12/1570')).toBe(true);
    expect(isInpageUrl('http://arxiv.org/abs/2610.00001')).toBe(false);
    expect(isInpageUrl('https://arxiv.org.evil.example/abs/1')).toBe(false);
    expect(isInpageUrl('https://www.google.com/search?q=x')).toBe(false);
    expect(isInpageUrl(undefined)).toBe(false);
    expect(isInpageUrl('not a url')).toBe(false);
  });
});

describe('who the service worker answers', () => {
  const scholarTab = { tab: {}, url: 'https://scholar.google.com/scholar?q=x' };

  it('the popup, anything', () => {
    for (const type of ['theses', 'save', 'create-collection', 'lookup'])
      expect(senderMay({ url: `${OWN}popup.html` }, type, OWN, INPAGE_REQUESTS)).toBe(true);
  });

  it('a content script, only the card’s requests, only from an in-page host', () => {
    // ADR-0154 added 'save-many': ticked results, no PDF, checked like 'save-one'.
    expect(INPAGE_REQUESTS).toEqual(['theses', 'collections', 'lookup', 'save-one', 'save-many']);
    for (const type of INPAGE_REQUESTS)
      expect(senderMay(scholarTab, type, OWN, INPAGE_REQUESTS)).toBe(true);
    // The popup's bulk save can fetch a PDF from any address: never on a content script's word.
    expect(senderMay(scholarTab, 'save', OWN, INPAGE_REQUESTS)).toBe(false);
    expect(senderMay(scholarTab, 'anywhere-sync', OWN, INPAGE_REQUESTS)).toBe(false);
    expect(senderMay(scholarTab, 'create-collection', OWN, INPAGE_REQUESTS)).toBe(false);
    expect(
      senderMay({ tab: {}, url: 'https://example.org/' }, 'theses', OWN, INPAGE_REQUESTS),
    ).toBe(false);
    expect(senderMay({ url: scholarTab.url }, 'theses', OWN, INPAGE_REQUESTS)).toBe(false);
  });
});
