/**
 * Builds the Chrome add-on — ADR-0031.
 *
 *   node scripts/build.mjs                                        # production → dist/
 *   node scripts/build.mjs --target development --out dist-dev    # against the dev stack
 *
 * `--extra-host <pattern>` adds a host the add-on may read without the toolbar click. It exists
 * for the browser test, which cannot click Chrome's toolbar and so cannot grant `activeTab`; the
 * production build never has one, and reads a page only when the student clicks.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  options: {
    target: { type: 'string', default: 'production' },
    out: { type: 'string', default: 'dist' },
    'extra-host': { type: 'string', multiple: true, default: [] },
  },
});

const TARGETS = {
  production: { api: 'https://thesis.rademics.ai', web: 'https://thesis.rademics.ai' },
  development: { api: 'http://localhost:3001', web: 'http://localhost:3000' },
};
const target = TARGETS[values.target];
if (!target) {
  throw new Error(`Unknown target "${values.target}". Known: ${Object.keys(TARGETS).join(', ')}`);
}

const out = resolve(root, values.out);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 1. TypeScript to ES modules Chrome loads as they are. No bundler: the add-on has no
//    dependencies, only its own files importing each other.
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
execFileSync(process.execPath, [tsc, '-p', join(root, 'tsconfig.build.json'), '--outDir', out], {
  stdio: 'inherit',
});

// 2. Where this build talks to (declared for the type checker in src/config.d.ts).
writeFileSync(
  join(out, 'config.js'),
  `export const API_URL = ${JSON.stringify(target.api)};\nexport const WEB_URL = ${JSON.stringify(target.web)};\n`,
);

// 3. The manifest. Three permissions: read the tab the student clicked on (`activeTab` and
//    `scripting`), and remember the thesis they last chose (`storage`). One host: the API.
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const icon = (size) => `icons/icon-${size}.png`;
const manifest = {
  manifest_version: 3,
  name: 'Thesis Copilot',
  description: 'Add the paper you are reading to your Thesis Copilot library in one click.',
  version: pkg.version,
  minimum_chrome_version: '116',
  action: {
    default_popup: 'popup.html',
    default_title: 'Add this paper to Thesis Copilot',
    default_icon: { 16: icon(16), 32: icon(32), 48: icon(48) },
  },
  icons: { 16: icon(16), 32: icon(32), 48: icon(48), 128: icon(128) },
  background: { service_worker: 'background.js', type: 'module' },
  permissions: ['activeTab', 'scripting', 'storage'],
  host_permissions: [`${target.api}/*`, ...values['extra-host']],
};
writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

// 4. The page, its styles and the icons (the SVG is the source of the PNGs, not shipped).
cpSync(join(root, 'static'), out, { recursive: true, filter: (src) => !src.endsWith('.svg') });

console.log(`Built the ${values.target} add-on in ${out} (API ${target.api}).`);
