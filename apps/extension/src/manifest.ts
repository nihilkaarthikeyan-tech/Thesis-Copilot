/**
 * The add-on's manifest — ADR-0031, ADR-0069, ADR-0125, ADR-0156. `scripts/build.mjs` writes it
 * from here, so what Chrome is asked for is tested (`test/manifest.spec.ts`). Every permission is
 * justified in `STORE.md`, one by one.
 */

import { ANYWHERE_MATCHES, anywhereExcludes, ownHosts } from './anywhere.js';
import { INPAGE_MATCHES } from './hosts.js';

export type ManifestInput = {
  version: string;
  api: string;
  web: string;
  /** Development only: hosts a browser test may read without the toolbar click. */
  extraHosts?: readonly string[];
};

const icon = (size: number) => `icons/icon-${size}.png`;

export function buildManifest(input: ManifestInput) {
  const own = ownHosts([input.api, input.web]);
  return {
    manifest_version: 3,
    name: 'Thesis Copilot',
    description:
      'Save the papers you read to your Thesis Copilot library — from a button on the page, a page of results, or the PDF.',
    version: input.version,
    // 127: `chrome.action.openPopup` for every add-on, which the right-click item uses.
    minimum_chrome_version: '127',
    action: {
      default_popup: 'popup.html',
      default_title: 'Save to Thesis Copilot',
      default_icon: { 16: icon(16), 32: icon(32), 48: icon(48) },
    },
    icons: { 16: icon(16), 32: icon(32), 48: icon(48), 128: icon(128) },
    background: { service_worker: 'background.js', type: 'module' },
    // Opens the popup from the keyboard. S for save (ADR-0069). The student can change it at
    // chrome://extensions/shortcuts, and the settings show whatever is assigned.
    commands: {
      _execute_action: {
        suggested_key: { default: 'Alt+Shift+S', mac: 'Alt+Shift+S' },
        description: 'Open Thesis Copilot',
      },
    },
    permissions: ['activeTab', 'scripting', 'storage', 'contextMenus'],
    // ADR-0156: the add-on's own service, and every https site for the Save buttons beside papers
    // (the second content script below). Taken at install, so the buttons appear with no switch
    // pressed; the student turns them off in the add-on's settings.
    host_permissions: [
      ...new Set([`${input.api}/*`, ...ANYWHERE_MATCHES, ...(input.extraHosts ?? [])]),
    ],
    content_scripts: [
      // ADR-0125: the scholarly sites with their own readers (results pages, PubMed, arXiv, MDPI).
      {
        matches: [...INPAGE_MATCHES],
        js: ['content.js'],
        run_at: 'document_idle',
        all_frames: false,
      },
      // ADR-0154/0156: every other https page — an article's tags and a reference list's DOIs.
      // Never on the sites above (they have their own entry) or on Thesis Copilot itself.
      {
        matches: [...ANYWHERE_MATCHES],
        exclude_matches: anywhereExcludes(own),
        js: ['content.js'],
        run_at: 'document_idle',
        all_frames: false,
      },
    ],
    // Stated rather than left to the default, so a reviewer sees it: only the package's own code.
    content_security_policy: {
      extension_pages:
        "script-src 'self'; object-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    },
  };
}
