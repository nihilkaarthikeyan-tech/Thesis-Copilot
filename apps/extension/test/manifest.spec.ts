/**
 * ADR-0156, add-on 0.4.0: what the manifest asks Chrome for. The Save buttons are on every https
 * page from install — no optional permission and no switch to press — and never on Thesis
 * Copilot's own site.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INPAGE_MATCHES } from '../src/hosts.js';
import { buildManifest } from '../src/manifest.js';

const PRODUCTION = {
  version: '0.4.0',
  api: 'https://thesis.rademics.ai',
  web: 'https://thesis.rademics.ai',
};

describe('the manifest', () => {
  const manifest = buildManifest(PRODUCTION);

  it('takes every https site at install, for the buttons, and asks for nothing later', () => {
    expect(manifest.host_permissions).toEqual(['https://thesis.rademics.ai/*', 'https://*/*']);
    expect(manifest).not.toHaveProperty('optional_host_permissions');
    expect(manifest.permissions).toEqual(['activeTab', 'scripting', 'storage', 'contextMenus']);
  });

  it('runs the content script on the five sites and on every other https page, top frame only', () => {
    const [sites, everywhere] = manifest.content_scripts;
    expect(sites?.matches).toEqual([...INPAGE_MATCHES]);
    expect(everywhere?.matches).toEqual(['https://*/*']);
    for (const entry of manifest.content_scripts) {
      expect(entry.js).toEqual(['content.js']);
      expect(entry.all_frames).toBe(false);
      expect(entry.run_at).toBe('document_idle');
    }
  });

  it('never on Thesis Copilot itself, or twice on the five sites', () => {
    const excluded = manifest.content_scripts[1]?.exclude_matches ?? [];
    expect(excluded).toContain('https://thesis.rademics.ai/*');
    expect(excluded).toContain('https://*.thesis.rademics.ai/*');
    for (const pattern of INPAGE_MATCHES) expect(excluded).toContain(pattern);
  });

  it('a development build adds its extra hosts, and only to host_permissions', () => {
    const dev = buildManifest({
      ...PRODUCTION,
      api: 'http://localhost:3001',
      web: 'http://localhost:3000',
      extraHosts: ['http://127.0.0.1:4100/*'],
    });
    expect(dev.host_permissions).toEqual([
      'http://localhost:3001/*',
      'https://*/*',
      'http://127.0.0.1:4100/*',
    ]);
  });

  it('carries the package version, 0.4.0', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
    expect(pkg.version).toBe('0.4.0');
    expect(buildManifest({ ...PRODUCTION, version: pkg.version }).version).toBe('0.4.0');
  });
});
