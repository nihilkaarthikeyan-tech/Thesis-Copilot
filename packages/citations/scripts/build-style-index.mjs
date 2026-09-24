#!/usr/bin/env node
/**
 * Builds `styles/catalog.json.gz` — every style in the Citation Style Language repository, as a
 * searchable index.
 *
 *   node packages/citations/scripts/build-style-index.mjs <path-to-extracted-styles-repo> <commit>
 *
 * The repository is downloaded by hand (or by CI) as a tarball at a pinned commit and extracted;
 * this reads each style's `<info>` block and writes one compact record per style. The XML itself
 * is **not** copied here: 2,862 independent styles are 58 MB, and a student uses one or two. The
 * API fetches a style's XML from the same pinned commit when a student chooses it, and keeps its
 * own copy from then on (`apps/api/.../style-store.service.ts`) — so rendering and export never need the network.
 *
 * Why a script and not a download at runtime: the index is what makes 10,000 styles searchable,
 * and searching must not depend on GitHub being up. It is small (about 300 KB gzipped) and changes
 * only when someone re-runs this against a newer commit.
 *
 * Licence: every CSL style is CC BY-SA 3.0. The catalogue records the commit it came from, and the
 * style picker credits the project.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const [repoDir, commit] = process.argv.slice(2);
if (!repoDir || !commit) {
  console.error('usage: build-style-index.mjs <extracted-styles-repo> <commit-sha>');
  process.exit(1);
}

const ID_PREFIX = 'http://www.zotero.org/styles/';

/** The one piece of a style this needs: its `<info>` block, which is small and machine-written. */
function infoOf(xml) {
  const info = /<info>([\s\S]*?)<\/info>/.exec(xml)?.[1] ?? '';
  const text = (tag) => {
    const raw = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(info)?.[1];
    return raw ? decode(raw.trim()) : undefined;
  };
  const link = (rel) =>
    new RegExp(`<link[^>]*href="([^"]+)"[^>]*rel="${rel}"`).exec(info)?.[1] ??
    new RegExp(`<link[^>]*rel="${rel}"[^>]*href="([^"]+)"`).exec(info)?.[1];
  const format = /<category[^>]*citation-format="([^"]+)"/.exec(info)?.[1];
  const fields = [...info.matchAll(/<category[^>]*field="([^"]+)"/g)].map((m) => m[1]);
  const locale = /<style[^>]*default-locale="([^"]+)"/.exec(xml)?.[1];
  return { title: text('title'), short: text('title-short'), link, format, fields, locale };
}

function decode(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

const records = [];
const skipped = [];

for (const file of readdirSync(repoDir).filter((f) => f.endsWith('.csl'))) {
  const id = file.slice(0, -4);
  const info = infoOf(readFileSync(join(repoDir, file), 'utf8'));
  if (!info.title || !info.format) {
    skipped.push(id);
    continue;
  }
  records.push({
    id,
    t: info.title,
    ...(info.short && info.short !== info.title ? { s: info.short } : {}),
    f: info.format,
    ...(info.fields.length ? { c: info.fields } : {}),
  });
}

const independent = new Set(records.map((r) => r.id));
const dependentDir = join(repoDir, 'dependent');
for (const file of readdirSync(dependentDir).filter((f) => f.endsWith('.csl'))) {
  const id = file.slice(0, -4);
  const info = infoOf(readFileSync(join(dependentDir, file), 'utf8'));
  const parentUrl = info.link('independent-parent');
  const parent = parentUrl?.startsWith(ID_PREFIX) ? parentUrl.slice(ID_PREFIX.length) : undefined;
  // A dependent whose parent is not in this commit cannot be rendered; leaving it out is honest.
  if (!info.title || !parent || !independent.has(parent)) {
    skipped.push(`dependent/${id}`);
    continue;
  }
  records.push({
    id,
    t: info.title,
    p: parent,
    ...(info.format ? { f: info.format } : {}),
    ...(info.locale && info.locale !== 'en-US' ? { l: info.locale } : {}),
  });
}

records.sort((a, b) => a.t.localeCompare(b.t, 'en'));

const catalog = {
  source: 'https://github.com/citation-style-language/styles',
  commit,
  licence: 'CC BY-SA 3.0 — https://creativecommons.org/licenses/by-sa/3.0/',
  count: records.length,
  styles: records,
};

const out = new URL('../styles/catalog.json.gz', import.meta.url);
writeFileSync(out, gzipSync(Buffer.from(JSON.stringify(catalog), 'utf8'), { level: 9 }));
console.log(
  `${records.length} styles (${independent.size} independent) → ${out.pathname}; skipped ${skipped.length}`,
);
if (skipped.length)
  console.log(`skipped: ${skipped.slice(0, 20).join(', ')}${skipped.length > 20 ? ' …' : ''}`);
