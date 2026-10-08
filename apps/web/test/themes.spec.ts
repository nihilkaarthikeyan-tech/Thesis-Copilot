/**
 * The paper themes (R33, ADR-0120) and the colours on the words (R28, ADR-0119), read straight
 * from `globals.css`: every colour token the light theme has, each paper theme has too (a missing
 * one would fall through to light's value on the dark paper), and the contrast the ADR states
 * holds.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Without its comments, so a comment before a declaration is not read as part of its name. */
const CSS = readFileSync(resolve(__dirname, '../src/app/globals.css'), 'utf8')
  .replaceAll('\r\n', '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * The declarations of the first rule written `selector {` — and, when `containing` is given, the
 * first such rule that declares it.
 */
function block(selector: string, containing?: string): Record<string, string> {
  let at = CSS.indexOf(`${selector} {`);
  while (at >= 0 && containing && !CSS.slice(at, CSS.indexOf('}', at)).includes(containing)) {
    at = CSS.indexOf(`${selector} {`, at + 1);
  }
  if (at < 0) throw new Error(`no rule for ${selector}`);
  const body = CSS.slice(CSS.indexOf('{', at) + 1, CSS.indexOf('}', at));
  const out: Record<string, string> = {};
  for (const line of body.split(';')) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const name = line.slice(0, colon).trim();
    if (name.startsWith('--')) out[name] = line.slice(colon + 1).trim();
  }
  return out;
}

function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = Number.parseInt(value.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const LIGHT = block('@theme');
const PAPER_LIGHT = block(':root[data-theme="paper-light"]:not([data-contrast="high"])');
const PAPER_DARK = block(':root[data-theme="paper-dark"]:not([data-contrast="high"])');

describe('the paper themes', () => {
  const colourTokens = Object.keys(LIGHT).filter((name) => name.startsWith('--color-'));

  it('define every colour token the light theme has', () => {
    expect(colourTokens.length).toBeGreaterThan(15);
    for (const theme of [PAPER_LIGHT, PAPER_DARK]) {
      expect(colourTokens.filter((name) => !(name in theme))).toEqual([]);
    }
  });

  it('keep text, the accent and its label readable', () => {
    for (const theme of [PAPER_LIGHT, PAPER_DARK]) {
      const t = (name: string) => theme[`--color-${name}`] ?? '';
      expect(contrast(t('ink'), t('paper'))).toBeGreaterThanOrEqual(7);
      expect(contrast(t('ink'), t('surface'))).toBeGreaterThanOrEqual(7);
      expect(contrast(t('muted'), t('surface'))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t('accent'), t('surface'))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t('accent-ink'), t('accent'))).toBeGreaterThanOrEqual(4.5);
      // Unaccepted AI text must look unlike the student's own (PRD §6.2).
      expect(contrast(t('ghost'), t('ink'))).toBeGreaterThan(2);
    }
  });

  it('give paper dark the dark text colours, and high contrast wins over both', () => {
    expect(CSS).toContain(
      ':root[data-theme="dark"],\n:root[data-theme="paper-dark"] {\n  --ink-grey',
    );
    expect(CSS).toContain(
      ':root[data-theme="dark"][data-contrast="high"],\n:root[data-theme="paper-dark"][data-contrast="high"] {',
    );
    // The system-dark rules apply only when no theme is stamped, so a paper theme holds on a
    // dark device.
    expect(CSS).not.toContain(':root:not([data-theme="light"])');
  });
});

describe('the colours on the words in light', () => {
  const words = block(':root', '--ink-grey');
  it('are the print colours, readable on white', () => {
    for (const name of ['grey', 'red', 'orange', 'green', 'blue', 'purple']) {
      expect(contrast(words[`--ink-${name}`] ?? '', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    }
  });
});
