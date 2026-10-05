/**
 * Builds the Chrome add-on — ADR-0031, ADR-0069.
 *
 *   node scripts/build.mjs                                        # production → dist/ + the zip
 *   node scripts/build.mjs --target development --out dist-dev    # against the dev stack
 *   node scripts/build.mjs --target development --api http://localhost:3301 --web http://localhost:3300
 *
 * The production build also writes `thesis-copilot-chrome-<version>.zip` next to `dist/`, holding
 * the contents of `dist/` and nothing else — the file the Chrome Web Store takes (PUBLISHING.md).
 *
 * `--extra-host <pattern>` adds a host the add-on may read without the toolbar click. It exists
 * for the browser test, which cannot click Chrome's toolbar and so cannot grant `activeTab`; the
 * production build never has one, and reads a page only when the student clicks.
 */

import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import JSZip from 'jszip';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  options: {
    target: { type: 'string', default: 'production' },
    out: { type: 'string', default: 'dist' },
    api: { type: 'string' },
    web: { type: 'string' },
    'extra-host': { type: 'string', multiple: true, default: [] },
    'no-zip': { type: 'boolean', default: false },
  },
});

const TARGETS = {
  production: { api: 'https://thesis.rademics.ai', web: 'https://thesis.rademics.ai' },
  development: { api: 'http://localhost:3001', web: 'http://localhost:3000' },
};
const preset = TARGETS[values.target];
if (!preset) {
  throw new Error(`Unknown target "${values.target}". Known: ${Object.keys(TARGETS).join(', ')}`);
}
if (values.target === 'production' && (values.api || values.web || values['extra-host'].length)) {
  throw new Error(
    'The production build talks to thesis.rademics.ai only; --api/--web/--extra-host are for development.',
  );
}
const target = { api: values.api ?? preset.api, web: values.web ?? preset.web };

const out = resolve(root, values.out);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 1. TypeScript to ES modules Chrome loads as they are. No bundler: the add-on has no runtime
//    dependencies, only its own files importing each other — all of it in the package, none of
//    it fetched (Manifest V3 forbids remote code).
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
execFileSync(process.execPath, [tsc, '-p', join(root, 'tsconfig.build.json'), '--outDir', out], {
  stdio: 'inherit',
});

// 2. Where this build talks to (declared for the type checker in src/config.d.ts).
writeFileSync(
  join(out, 'config.js'),
  `export const API_URL = ${JSON.stringify(target.api)};\nexport const WEB_URL = ${JSON.stringify(target.web)};\n`,
);

// 3. The manifest. Every permission is justified in STORE.md, one by one.
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const icon = (size) => `icons/icon-${size}.png`;
const manifest = {
  manifest_version: 3,
  name: 'Thesis Copilot',
  description:
    'Save the papers you read — one, a page of results, or the PDF — to your Thesis Copilot library.',
  version: pkg.version,
  // 127: `chrome.action.openPopup` for every add-on, which the right-click item uses.
  minimum_chrome_version: '127',
  action: {
    default_popup: 'popup.html',
    default_title: 'Save to Thesis Copilot',
    default_icon: { 16: icon(16), 32: icon(32), 48: icon(48) },
  },
  icons: { 16: icon(16), 32: icon(32), 48: icon(48), 128: icon(128) },
  background: { service_worker: 'background.js', type: 'module' },
  // Opens the popup from the keyboard. S for save. Chromium on Windows leaves Alt+Shift+T (its
  // own "focus the toolbar"), Alt+Shift+P and Alt+Shift+C unassigned — checked by loading the
  // add-on and reading chrome.commands.getAll() (ADR-0069). The student can change it at
  // chrome://extensions/shortcuts, and the popup's footer shows whatever is assigned.
  commands: {
    _execute_action: {
      suggested_key: { default: 'Alt+Shift+S', mac: 'Alt+Shift+S' },
      description: 'Open Thesis Copilot',
    },
  },
  permissions: ['activeTab', 'scripting', 'storage', 'contextMenus'],
  host_permissions: [`${target.api}/*`, ...values['extra-host']],
  // Stated rather than left to the default, so a reviewer sees it: only the package's own code.
  content_security_policy: {
    extension_pages:
      "script-src 'self'; object-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  },
};
writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

// 4. The page, its styles, the fonts and the icons (the SVG is the source of the PNGs, not shipped).
cpSync(join(root, 'static'), out, { recursive: true, filter: (src) => !src.endsWith('.svg') });

console.log(`Built the ${values.target} add-on in ${out} (API ${target.api}).`);

// 5. The store's zip: the contents of dist/, nothing else.
if (values.target === 'production' && !values['no-zip']) {
  const zip = new JSZip();
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else zip.file(relative(out, path).split('\\').join('/'), readFileSync(path));
    }
  };
  walk(out);
  const file = join(root, `thesis-copilot-chrome-${pkg.version}.zip`);
  writeFileSync(
    file,
    await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
    }),
  );
  console.log(`Wrote ${relative(root, file)} for the Chrome Web Store.`);
}
