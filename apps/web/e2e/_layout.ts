/**
 * Measuring a screen's layout in the browser (2026-10-08): the three faults the owner's
 * screenshot showed and the audit then found more of — the page wider than the window, something
 * sticking out of (or cut off by) its box, and text cut mid-word without an ellipsis. Shared by the
 * layout guard (`layout.spec.ts`, in CI) and the full audit (`_measure/layout-audit.spec.ts`).
 */

import type { Page } from '@playwright/test';

export type LayoutFault = { kind: string; by?: number; el?: string; box?: string; html?: string };

/** Runs in the page. Kept free of closures: Playwright sends it as source. */
export function measureLayout(detail: boolean): LayoutFault[] {
  const out: LayoutFault[] = [];
  const root = document.documentElement;
  const vw = root.clientWidth;
  if (root.scrollWidth > vw + 1) {
    out.push({ kind: 'page wider than window', by: root.scrollWidth - vw });
  }
  const FRAME_TAGS = [
    'ASIDE',
    'MAIN',
    'NAV',
    'LI',
    'SECTION',
    'ARTICLE',
    'DIALOG',
    'TD',
    'TH',
    'BUTTON',
    'LABEL',
  ];
  const isFrame = (el: Element) => {
    if (FRAME_TAGS.includes(el.tagName)) return true;
    const role = el.getAttribute('role');
    if (role === 'dialog' || role === 'tablist') return true;
    const s = getComputedStyle(el);
    return parseFloat(s.borderLeftWidth) > 0 && parseFloat(s.borderRightWidth) > 0;
  };
  const name = (el: Element) => {
    const id = el.getAttribute('data-testid');
    const text = ((el as HTMLElement).innerText || el.getAttribute('aria-label') || '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 40);
    return `${el.tagName.toLowerCase()}${id ? `[${id}]` : ''} "${text}"`;
  };
  // Inside a closed <details> nothing is laid out for real (the browser keeps it hidden), so
  // what it measures is not what anyone sees; it is measured when it is opened.
  const folded = (el: Element) => {
    const shut = el.closest('details:not([open])');
    return shut !== null && !el.closest('summary');
  };
  for (const el of document.body.querySelectorAll('*')) {
    if (folded(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || ['fixed', 'absolute', 'sticky'].includes(s.position)) continue;
    let p = el.parentElement;
    let skip = false;
    let frame: Element | null = null;
    while (p && p !== document.body) {
      const ps = getComputedStyle(p);
      if (ps.position === 'absolute' || ps.position === 'fixed') {
        skip = true;
        break;
      }
      if (isFrame(p)) {
        frame = p;
        break;
      }
      if (ps.overflowX !== 'visible') {
        skip = true;
        break;
      }
      p = p.parentElement;
    }
    if (skip || !frame) continue;
    const fs = getComputedStyle(frame);
    if (fs.overflowX === 'auto' || fs.overflowX === 'scroll') continue;
    // A box that truncates with an ellipsis cuts its text on purpose, and says so.
    if (fs.overflowX !== 'visible' && fs.textOverflow === 'ellipsis') continue;
    const f = frame.getBoundingClientRect();
    const over = Math.max(r.right - f.right, f.left - r.left);
    // A run of text that wraps lets the space at each line break hang past the margin; nothing
    // visible sticks out, so an overshoot of up to a space's width by a run that holds a space is
    // not a fault (a visible character would be wider).
    const hangingSpace =
      s.display.startsWith('inline') && /\s/.test(el.textContent ?? '') && over <= 6;
    if (over > 1.5 && !hangingSpace) {
      out.push({
        kind: fs.overflowX === 'visible' ? 'sticks out of its box' : 'cut off by its box',
        by: Math.round(over),
        el: name(el),
        box: name(frame),
        ...(detail ? { html: el.outerHTML.slice(0, 300) } : {}),
      });
    }
  }
  // Visually hidden on purpose (Tailwind's sr-only: 1 px, clipped): read by a screen reader only.
  const srOnly = (el: Element) => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return (r.width <= 1 && r.height <= 1) || (s.position === 'absolute' && s.clip !== 'auto');
  };
  for (const el of document.body.querySelectorAll('*')) {
    const s = getComputedStyle(el);
    if (srOnly(el) || folded(el)) continue;
    if (
      (s.overflowX === 'hidden' || s.overflowX === 'clip') &&
      s.textOverflow !== 'ellipsis' &&
      el.clientWidth > 0 &&
      el.scrollWidth > el.clientWidth + 2 &&
      [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim())
    ) {
      out.push({
        kind: 'text cut without an ellipsis',
        by: el.scrollWidth - el.clientWidth,
        el: name(el),
      });
    }
  }
  // A menu, popover or hint is positioned on its own (absolute or fixed), so the box check above
  // skips it; QA 2026-10-08 found the thesis card's "More" menu running from -41 to 119 px at
  // 390 px wide, its items cut to "a chapter", "als", "ve". Each one that is shown and partly on
  // the screen must lie wholly inside the window. Not counted: what nobody sees (sr-only, hidden,
  // transparent, clipped away by a scrolling box), decoration (aria-hidden, no pointer events),
  // and anything wholly off the screen on purpose (a closed drawer slid out of view).
  const shown = (el: Element) => {
    const check = (el as { checkVisibility?: (o: object) => boolean }).checkVisibility;
    if (check && !check.call(el, { opacityProperty: true, visibilityProperty: true })) return false;
    return getComputedStyle(el).visibility !== 'hidden';
  };
  for (const el of document.body.querySelectorAll('*')) {
    const s = getComputedStyle(el);
    if (s.position !== 'absolute' && s.position !== 'fixed') continue;
    if (srOnly(el) || folded(el) || !shown(el)) continue;
    if (el.closest('[aria-hidden="true"]') || s.pointerEvents === 'none') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    // What a scrolling or clipping box around it leaves visible (not the page itself).
    let left = r.left;
    let right = r.right;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ps = getComputedStyle(p);
      if (ps.overflowX === 'visible') continue;
      const pr = p.getBoundingClientRect();
      left = Math.max(left, pr.left);
      right = Math.min(right, pr.right);
    }
    if (right - left < 2) continue;
    if (right <= 0 || left >= vw) continue;
    const off = Math.max(-left, right - vw);
    if (off > 1.5) {
      out.push({
        kind: 'menu or popover off the screen',
        by: Math.round(off),
        el: name(el),
        box: `window 0..${vw}, it ${Math.round(left)}..${Math.round(right)}`,
        ...(detail ? { html: el.outerHTML.slice(0, 300) } : {}),
      });
    }
  }
  const seen = new Set<string>();
  return out.filter((f) => {
    const k = `${f.kind}|${f.el}|${f.box}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Loaded, the network quiet, and a moment for the last paint. */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
  await page.waitForTimeout(800);
}
