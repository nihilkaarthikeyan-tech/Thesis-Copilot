/**
 * Draws `static/icons/icon.svg` at the sizes Chrome asks for (16, 32, 48, 128). Run it after
 * changing the SVG; the PNGs are committed, so a build never needs a browser.
 *
 *   node scripts/icons.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const svg = readFileSync(new URL('../static/icons/icon.svg', import.meta.url), 'utf8');
const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}img{display:block}</style><img src="${src}" width="${size}" height="${size}">`,
  );
  await page.locator('img').screenshot({
    path: fileURLToPath(new URL(`../static/icons/icon-${size}.png`, import.meta.url)),
    omitBackground: true,
  });
}
await browser.close();
console.log('Wrote icon-16/32/48/128.png');
