/**
 * Draws `static/icons/icon.svg` (the product's LogoMark) at the sizes Chrome asks for, with
 * Chromium so the PNGs are the SVG exactly — no hand-drawn approximation. Run it after changing
 * the SVG; the PNGs are committed, so a build never needs a browser.
 *
 *   node scripts/icons.mjs
 *
 * Padding (ADR-0069):
 * - 128: the Chrome Web Store's rule — 96×96 artwork inside 16 px of transparent padding a side.
 * - 48 (chrome://extensions): the same proportion, 36×36 inside 6 px.
 * - 16 and 32 (the toolbar, 1× and 2×): edge to edge. Chrome draws them inside a larger button,
 *   which is the padding; at 16 px every pixel of the mark is needed for the T to stay legible.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const svg = readFileSync(new URL('../static/icons/icon.svg', import.meta.url), 'utf8');
const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

const SIZES = [
  { size: 16, art: 16 },
  { size: 32, art: 32 },
  { size: 48, art: 36 },
  { size: 128, art: 96 },
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const { size, art } of SIZES) {
  const pad = (size - art) / 2;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}div{width:${size}px;height:${size}px;box-sizing:border-box;padding:${pad}px}img{display:block}</style><div><img src="${src}" width="${art}" height="${art}"></div>`,
  );
  await page.locator('img').evaluate((img) => img.decode());
  await page.locator('div').screenshot({
    path: fileURLToPath(new URL(`../static/icons/icon-${size}.png`, import.meta.url)),
    omitBackground: true,
  });
}
await browser.close();
console.log('Wrote icon-16/32/48/128.png');
