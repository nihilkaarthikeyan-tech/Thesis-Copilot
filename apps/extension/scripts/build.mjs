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
 *
 * The content script (ADR-0125) is the one file not compiled by tsc alone: Chrome loads a
 * content script as a classic script, not a module, so `src/content.ts` and what it imports are
 * joined into one `content.js` by esbuild — not minified, so a reviewer reads it as written. It
 * runs on `INPAGE_MATCHES` (`src/hosts.ts`) and, since 0.4.0, on every other https page except
 * Thesis Copilot's own (ADR-0156, `src/manifest.ts`). `--open-shadow` (development only, for the
 * browser test) opens the in-page shadow roots so a test can read the card; production keeps
 * them closed.
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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';
import JSZip from 'jszip';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  options: {
    target: { type: 'string', default: 'production' },
    out: { type: 'string', default: 'dist' },
    api: { type: 'string' },
    web: { type: 'string' },
    'extra-host': { type: 'string', multiple: true, default: [] },
    'open-shadow': { type: 'boolean', default: false },
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
if (
  values.target === 'production' &&
  (values.api || values.web || values['extra-host'].length || values['open-shadow'])
) {
  throw new Error(
    'The production build talks to thesis.rademics.ai only, with closed shadow roots; --api/--web/--extra-host/--open-shadow are for development.',
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
const shadow = values['open-shadow'] ? 'open' : 'closed';
writeFileSync(
  join(out, 'config.js'),
  `export const API_URL = ${JSON.stringify(target.api)};\nexport const WEB_URL = ${JSON.stringify(target.web)};\nexport const INPAGE_SHADOW = ${JSON.stringify(shadow)};\n`,
);

// 2b. The content script: one classic script, joined by esbuild (see the header). Its
//     `./config.js` is the one just written for this target.
await build({
  // The file names esbuild writes as comments are relative to the package, not this machine.
  absWorkingDir: root,
  entryPoints: [join(root, 'src', 'content.ts')],
  outfile: join(out, 'content.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome127',
  minify: false,
  legalComments: 'none',
  charset: 'utf8',
  logLevel: 'warning',
  tsconfig: join(root, 'tsconfig.build.json'),
  plugins: [
    {
      name: 'target-config',
      setup(esbuild) {
        esbuild.onResolve({ filter: /^\.\/config\.js$/ }, () => ({
          path: join(out, 'config.js'),
        }));
      },
    },
  ],
});

// 3. The manifest (src/manifest.ts, tested). Every permission is justified in STORE.md, one by one.
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const { buildManifest } = await import(pathToFileURL(join(out, 'manifest.js')).href);
const manifest = buildManifest({
  version: pkg.version,
  api: target.api,
  web: target.web,
  extraHosts: values['extra-host'],
});
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
