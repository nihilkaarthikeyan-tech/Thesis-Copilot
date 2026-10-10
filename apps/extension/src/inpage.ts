/**
 * "Add to Thesis Copilot" inside the page — ADR-0125, ADR-0153. The content script (`content.ts`)
 * runs this on the hosts in `hosts.ts` only: Google Scholar and PubMed results, PubMed and arXiv
 * article pages, arXiv listings and searches, MDPI articles and MDPI search results.
 *
 * - **Where a button goes.** On an article page, beside the link to the article's own DOI (or
 *   under its title when the page shows no DOI link); on a results page, on every result. The
 *   paper is the one the page's own metadata names (`refs.ts`) — never one guessed from links.
 * - **What it shows.** A card, fixed at the top right of the window (on a narrow window a sheet
 *   along the bottom, or the top when the page cannot scroll the result being saved clear of it),
 *   with the paper as the library
 *   finds it for that identifier (`lookup-id`), what the page itself says about it (Google
 *   Scholar's "Cited by", a PDF the page links), the thesis and collection, and Save.
 * - **What it reads and sends.** It reads the page's meta tags and each result as `page.ts` does
 *   for the popup; it fetches nothing from the site. Only the identifier goes to Thesis Copilot
 *   (and, for a result that has none, the reference line the popup has always sent).
 * - **The host page is left alone.** Every button and the card live in closed shadow roots, so
 *   the page's styles cannot reach in and its scripts cannot read the student's thesis titles;
 *   the button is an inline box that wraps like a word; the card is fixed, so it takes no room.
 *   Everything is written with `textContent`.
 * - **What it remembers.** The identifiers of the papers its buttons saved, per thesis, in
 *   `chrome.storage.local` only (`memory.ts`), so a page visited again marks them "Saved".
 */

import {
  type CardEvent,
  type CardView,
  canSave,
  cardInitial,
  reduceCard,
  saveRef,
} from './card.js';
import { itemFrom, type ListItem, type Site } from './lists.js';
import { paperKeys, remember, SAVED_KEY, wasSaved } from './memory.js';
import type {
  Collection,
  Preview,
  Reply,
  Request,
  SaveOneJob,
  SaveOneResult,
  Thesis,
} from './messages.js';
import { collectPageMeta, collectResultList } from './page.js';
import { doiFromUrl, type Paper } from './paper.js';
import { articleOnPage, type PaperRef, refLabel, refsOfItem } from './refs.js';

// ---- What a button saves ---------------------------------------------------------------------

/** What the page itself shows about the paper. Read here, shown in the card, never sent. */
export type PageFacts = {
  /** Google Scholar's own "Cited by" count for the result. */
  citedBy: number | null;
  /** The page links a PDF of it: Scholar's [PDF], arXiv's PDF link, a `citation_pdf_url` tag. */
  pdfOnPage: boolean;
  /**
   * Where the page itself says it is free to read: "Free in PubMed Central" (PubMed's PMCID link
   * or "Free PMC article"), or a Creative Commons licence in the article's tags. Null: not stated.
   */
  access: string | null;
};

export type InpageItem = {
  origin: 'article' | Site;
  paper: Paper;
  /** Identifiers to look up, strongest first. Empty: saved by its details. */
  refs: PaperRef[];
  facts: PageFacts;
};

export type Spot = {
  /** What the button belongs to — the result, or the DOI link — so a rescan does not add twice. */
  node: Element;
  anchor: Element;
  where: 'after' | 'append';
  item: InpageItem;
};

const MARK = 'data-tc-addon';

/** Lower case, letters and digits only: for finding a heading that is the paper's title. */
const squash = (text: string | null | undefined): string =>
  (text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const visible = (element: Element): boolean => {
  if (element.closest('[hidden], [aria-hidden="true"], template, noscript')) return false;
  const check = (element as Element & { checkVisibility?: () => boolean }).checkVisibility;
  return typeof check === 'function' ? check.call(element) : true;
};

/**
 * The visible link on the page to one of the article's own DOIs — the one that shows the DOI as
 * its text when there is one ("DOI: 10.1038/…"), else the first. PubMed puts a publisher's
 * full-text link to the same DOI (a logo, no text) in its side column first; a button there sat
 * in a column too narrow for it (observed 2026-10-10).
 */
function doiLink(dois: readonly string[]): Element | null {
  if (dois.length === 0) return null;
  let first: Element | null = null;
  for (const link of Array.from(document.querySelectorAll('a[href]'))) {
    let href = '';
    try {
      href = new URL(link.getAttribute('href') ?? '', document.baseURI).href;
    } catch {
      continue;
    }
    const doi = doiFromUrl(href)?.toLowerCase();
    if (!doi || !dois.includes(doi) || !visible(link)) continue;
    if ((link.textContent ?? '').toLowerCase().includes(doi)) return link;
    first ??= link;
  }
  return first;
}

/** PubMed's article page names a free PubMed Central copy by its PMCID link. */
function pmcOnPage(): boolean {
  return Boolean(
    document.querySelector(
      '#full-view-identifiers a[href*="pmc.ncbi.nlm.nih.gov/articles/PMC"], #full-view-identifiers a[data-ga-action="PMCID"]',
    ),
  );
}

/** The page's heading that is the paper's title, when no DOI link is shown. */
function titleHeading(title: string): Element | null {
  const want = squash(title).slice(0, 60);
  if (want.length < 8) return null;
  return (
    Array.from(document.querySelectorAll('h1')).find(
      (heading) => visible(heading) && squash(heading.textContent).includes(want),
    ) ?? null
  );
}

function scholarCitedBy(node: Element): number | null {
  // Scholar's "Cited by 1234" links to /scholar?cites=…; the number is read in any language.
  for (const link of Array.from(node.querySelectorAll('a[href*="cites="]'))) {
    const digits = (link.textContent ?? '').replace(/\D+/g, '');
    if (digits && digits.length <= 9) return Number(digits);
  }
  return null;
}

function resultFacts(site: Site, node: Element): PageFacts {
  if (site === 'scholar') {
    const pdf = Array.from(
      node.querySelectorAll('.gs_ggs a, .gs_or_ggsm a, h3.gs_rt .gs_ctc'),
    ).some((label) => /\[PDF\]/i.test(label.textContent ?? ''));
    return { citedBy: scholarCitedBy(node), pdfOnPage: pdf, access: null };
  }
  if (site === 'arxiv') {
    return {
      citedBy: null,
      pdfOnPage: Boolean(node.querySelector('a[href*="/pdf/"]')),
      access: null,
    };
  }
  if (site === 'mdpi') {
    // Each MDPI result has its PDF link (an icon) and its "Open Access" badge.
    const open = Array.from(node.querySelectorAll('.article-icons, .label')).some((label) =>
      /open access/i.test(label.textContent ?? ''),
    );
    return {
      citedBy: null,
      pdfOnPage: Boolean(node.querySelector('a.UD_Listings_ArticlePDF, a[href*="/pdf"]')),
      access: open ? 'Open access (MDPI)' : null,
    };
  }
  // PubMed: "Free PMC article." in the result's citation line.
  const pmc = Array.from(node.querySelectorAll('.free-resources')).some((label) =>
    /free pmc article/i.test(label.textContent ?? ''),
  );
  return { citedBy: null, pdfOnPage: false, access: pmc ? 'Free in PubMed Central' : null };
}

/** Where a result's button goes: in the row of links under it, as one more of them. */
function resultPlace(site: Site, node: Element): Pick<Spot, 'anchor' | 'where'> {
  if (site === 'scholar') {
    // The row with Save · Cite · Cited by; not the PDF box beside the result, also a .gs_fl.
    const rows = Array.from(node.querySelectorAll('.gs_fl')).filter(
      (row) => !row.closest('.gs_ggs'),
    );
    const row = rows[rows.length - 1];
    if (row) return { anchor: row, where: 'append' };
    const byline = node.querySelector('.gs_a');
    return byline ? { anchor: byline, where: 'after' } : { anchor: node, where: 'append' };
  }
  if (site === 'pubmed') {
    const line =
      node.querySelector('.docsum-citation.full-citation') ?? node.querySelector('.docsum-content');
    return { anchor: line ?? node, where: 'append' };
  }
  if (site === 'mdpi') {
    // After the result's own DOI link, in its "Journal 2025, 18(8), 1921; https://doi.org/…" line.
    const doi = node.querySelector('a[href*="doi.org/10."]');
    if (doi) return { anchor: doi, where: 'after' };
    const title = node.querySelector('a.title-link');
    return title ? { anchor: title, where: 'after' } : { anchor: node, where: 'append' };
  }
  // arXiv: a listing's <dt> (the id and its pdf/html links), or a search result's id line.
  const line = node.matches('dt') ? node : node.querySelector('p.list-title');
  return { anchor: line ?? node, where: 'append' };
}

const paperOf = (item: ListItem): Paper => ({
  title: item.title,
  doi: item.doi,
  reference: item.reference,
  byline: item.byline ?? null,
  year: item.year ?? null,
  venue: item.venue ?? null,
});

/**
 * Where the buttons go on this page, and what each one saves. An article page gets one button,
 * only when its own metadata names the article; a results page one per result; anything else
 * (an issue's contents, a journal's home, a robot check) none.
 */
export function findSpots(url: string = location.href): Spot[] {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return [];
  }
  const article = articleOnPage({ ...collectPageMeta(), url });
  if (article) {
    const at = doiLink(article.dois) ?? titleHeading(article.paper.title);
    if (!at) return [];
    return [
      {
        node: at,
        anchor: at,
        where: 'after',
        item: {
          origin: 'article',
          paper: article.paper,
          refs: article.refs,
          facts: {
            citedBy: null,
            pdfOnPage: article.pdfOnPage,
            access: article.licence ?? (pmcOnPage() ? 'Free in PubMed Central' : null),
          },
        },
      },
    ];
  }
  const listing = collectResultList(host, true, new URL(url).pathname);
  if (!listing) return [];
  const spots: Spot[] = [];
  for (const raw of listing.items) {
    const node = raw.node;
    const item = node ? itemFrom(listing.site, raw) : null;
    if (!node || !item) continue;
    spots.push({
      node,
      ...resultPlace(listing.site, node),
      item: {
        origin: listing.site,
        paper: paperOf(item),
        refs: refsOfItem(item),
        facts: resultFacts(listing.site, node),
      },
    });
  }
  return spots;
}

// ---- Shadow roots and styles -------------------------------------------------------------------

const roots = new WeakMap<Element, ShadowRoot>();

/** A host's shadow root — for the tests, which cannot reach into a closed one otherwise. */
export const shadowOf = (host: Element): ShadowRoot | null => roots.get(host) ?? null;

const sheets = new Map<string, CSSStyleSheet>();

function attach(host: HTMLElement, mode: ShadowRootMode, css: string): ShadowRoot {
  const root = host.attachShadow({ mode });
  roots.set(host, root);
  // The same rules two ways, so either one styles it: a <style> in the root (what extensions
  // commonly do), and a constructed sheet, which a page's CSP on inline styles cannot refuse.
  // Neither path was observed in a real Chrome in this build (ADR-0125).
  const style = document.createElement('style');
  style.textContent = css;
  root.append(style);
  try {
    let sheet = sheets.get(css);
    if (!sheet) {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      sheets.set(css, sheet);
    }
    root.adoptedStyleSheets = [sheet];
  } catch {
    // The <style> above is enough.
  }
  return root;
}

/** Inline, `!important` styles on the host itself: the one element the page's CSS can reach. */
function pin(host: HTMLElement, styles: Record<string, string>): void {
  for (const [name, value] of Object.entries(styles))
    host.style.setProperty(name, value, 'important');
}

const TOKENS = `
  --surface: #ffffff; --sunk: #eef1f5; --ink: #0f1724; --muted: #5b6678; --line: #e1e6ed;
  --line-strong: #cbd3de; --accent: #2743c4; --accent-hover: #1b2f8f; --accent-soft: #eaeffd;
  --accent-ink: #ffffff; --ok: #1d7a4b; --ok-soft: #e5f3eb; --warn: #92600e; --warn-soft: #fbf1dc;
  --danger: #b42318; --danger-soft: #fdecea; --logo-tile: #0f1724; --logo-glyph: #ffffff;
  --logo-dot: #8fa3ff;
  --font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif;`;

const DARK_TOKENS = `
  --surface: #141b28; --sunk: #0a0e16; --ink: #edf1f7; --muted: #a3adbd; --line: #243044;
  --line-strong: #34425c; --accent: #8ea2ff; --accent-hover: #aebcff; --accent-soft: #1c2748;
  --accent-ink: #0c111b; --ok: #5ccf95; --ok-soft: #10281c; --warn: #e7b35d; --warn-soft: #2a2315;
  --danger: #f19187; --danger-soft: #2d1715; --logo-tile: #edf1f7; --logo-glyph: #0f1724;
  --logo-dot: #2743c4;`;

const BUTTON_CSS = `
.tc-add {${TOKENS}
  all: initial; box-sizing: border-box; display: inline-flex; align-items: center; gap: 5px;
  max-width: 100%; margin: 0; padding: 1px 9px 1px 4px; border: 1px solid var(--line-strong);
  border-radius: 999px; background: var(--accent-soft); color: var(--accent-hover);
  font: 500 12px/18px var(--font); white-space: nowrap; vertical-align: middle; cursor: pointer;
}
@media (prefers-color-scheme: dark) { .tc-add {${DARK_TOKENS} color: var(--accent); } }
.tc-add:hover { border-color: var(--accent); }
.tc-add:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.tc-add[data-state="saved"], .tc-add[data-state="present"] {
  background: var(--ok-soft); color: var(--ok); border-color: var(--line);
}
.label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
svg { flex: none; width: 14px; height: 14px; }
.mark-tile { fill: var(--logo-tile); } .mark-glyph { fill: var(--logo-glyph); }
.mark-dot { fill: var(--logo-dot); }
`;

const CARD_CSS = `
.panel {${TOKENS}
  all: initial; box-sizing: border-box; display: block; width: 100%;
  max-height: calc(100vh - 32px); max-height: calc(100dvh - 32px); overflow: auto;
  overscroll-behavior: contain; background: var(--surface); color: var(--ink);
  border: 1px solid var(--line-strong); border-radius: 14px;
  box-shadow: 0 16px 40px rgba(15, 23, 36, 0.22); font: 400 13px/1.5 var(--font);
}
@media (prefers-color-scheme: dark) { .panel {${DARK_TOKENS}} }
.panel *, .panel *::before, .panel *::after { box-sizing: border-box; }
.top { display: flex; align-items: center; gap: 8px; padding: 10px 12px 10px 14px;
  border-bottom: 1px solid var(--line); }
.top svg { flex: none; width: 20px; height: 20px; }
.wordmark { flex: 1; min-width: 0; font-weight: 700; font-size: 14px; }
.mark-tile { fill: var(--logo-tile); } .mark-glyph { fill: var(--logo-glyph); }
.mark-dot { fill: var(--logo-dot); }
.close { all: unset; display: grid; place-items: center; width: 28px; height: 28px;
  border-radius: 6px; color: var(--muted); font-size: 18px; line-height: 1; cursor: pointer; }
.close:hover { background: var(--sunk); color: var(--ink); }
.body { padding: 12px 14px 14px; }
.body > * + * { margin-top: 10px; }
p { margin: 0; }
.eyebrow { color: var(--muted); font-size: 11px; font-weight: 500; letter-spacing: 0.06em;
  text-transform: uppercase; }
.title { margin-top: 2px; font-weight: 700; font-size: 14px; line-height: 1.35;
  overflow-wrap: anywhere; }
.byline, .muted { color: var(--muted); }
.byline, .id, .status { margin-top: 2px; font-size: 12px; overflow-wrap: anywhere; }
.id { font-family: ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace; font-size: 11.5px; }
.status.ok { color: var(--ok); }
.facts { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; margin: 8px 0 0;
  padding: 8px 10px; border-radius: 10px; background: var(--sunk); font-size: 12px; }
.facts dt { color: var(--muted); }
.facts dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.field { display: grid; gap: 4px; min-width: 0; }
label { color: var(--muted); font-size: 12px; font-weight: 500; }
select { width: 100%; min-width: 0; height: 32px; padding: 0 8px; border: 1px solid var(--line-strong);
  border-radius: 6px; background: var(--surface); color: var(--ink); font: 400 13px var(--font); }
.btn { all: unset; box-sizing: border-box; display: inline-flex; align-items: center;
  justify-content: center; gap: 6px; min-height: 34px; padding: 6px 14px; border-radius: 6px;
  background: var(--accent); color: var(--accent-ink); font: 600 13px/1.3 var(--font);
  text-align: center; cursor: pointer; text-decoration: none; max-width: 100%; }
.btn:hover { background: var(--accent-hover); }
.btn.secondary { background: transparent; color: var(--ink); border: 1px solid var(--line-strong); }
.btn.secondary:hover { background: var(--sunk); }
.btn[aria-disabled="true"], .btn:disabled { opacity: 0.55; cursor: default; }
.btn:focus-visible, .close:focus-visible, select:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 2px; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; }
.notice { padding: 9px 11px; border-radius: 10px; background: var(--sunk); font-size: 12.5px;
  overflow-wrap: anywhere; }
.notice strong { display: block; margin-bottom: 2px; font-size: 13px; }
.notice.ok { background: var(--ok-soft); } .notice.ok strong { color: var(--ok); }
.notice.warn { background: var(--warn-soft); } .notice.warn strong { color: var(--warn); }
.notice.error { background: var(--danger-soft); } .notice.error strong { color: var(--danger); }
.spinner { display: inline-block; width: 12px; height: 12px; margin-right: 6px;
  border: 2px solid var(--line-strong); border-top-color: var(--accent); border-radius: 50%;
  vertical-align: -2px; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
.panel.sheet { max-height: 50vh; max-height: 50dvh; border-width: 1px 0 0;
  border-radius: 14px 14px 0 0; box-shadow: 0 -12px 32px rgba(15, 23, 36, 0.2); }
.panel.sheet.at-top { border-width: 0 0 1px; border-radius: 0 0 14px 14px;
  box-shadow: 0 12px 32px rgba(15, 23, 36, 0.2); }
`;

// ---- Small DOM helpers ---------------------------------------------------------------------------

type Options = { text?: string; className?: string; testId?: string; fid?: string };

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: Options = {},
  ...children: Array<Node | null>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.text !== undefined) node.textContent = options.text;
  if (options.className) node.className = options.className;
  if (options.testId) node.dataset.testid = options.testId;
  if (options.fid) node.dataset.fid = options.fid;
  for (const child of children) if (child) node.append(child);
  return node;
}

/** The LogoMark, drawn as elements (no markup parsed from a string). */
function logo(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('aria-hidden', 'true');
  const shape = (name: string, attrs: Record<string, string>, className: string) => {
    const node = document.createElementNS(ns, name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    node.setAttribute('class', className);
    svg.append(node);
  };
  shape('rect', { width: '64', height: '64', rx: '15' }, 'mark-tile');
  shape('path', { d: 'M11 15h30v7.5H29.8V50h-7.6V22.5H11z' }, 'mark-glyph');
  shape('circle', { cx: '48', cy: '19', r: '6' }, 'mark-dot');
  return svg;
}

/** A link that opens Thesis Copilot in a new tab: a real link, so it works without `tabs`. */
function siteLink(label: string, href: string, options: Options & { secondary?: boolean } = {}) {
  const link = el('a', {
    ...options,
    text: label,
    className: `btn${options.secondary ? ' secondary' : ''}`,
  });
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

function notice(kind: 'ok' | 'warn' | 'error' | 'note', title: string, ...lines: string[]) {
  return el(
    'div',
    { className: `notice${kind === 'note' ? '' : ` ${kind}`}`, testId: 'tc-message' },
    el('strong', { text: title }),
    ...lines.filter(Boolean).map((line) => el('p', { text: line })),
  );
}

function spinnerLine(text: string): HTMLElement {
  const line = el('p', { className: 'muted' });
  line.append(el('span', { className: 'spinner' }), document.createTextNode(text));
  return line;
}

// ---- The button ------------------------------------------------------------------------------------

export type ButtonState = 'idle' | 'saved' | 'present';

const LABELS: Record<ButtonState, string> = {
  idle: 'Add to Thesis Copilot',
  saved: 'Saved to Thesis Copilot',
  present: 'In your library',
};

export type ButtonControl = {
  host: HTMLElement;
  button: HTMLButtonElement;
  setState(state: ButtonState): void;
};

/** Puts one button into the page at its spot. */
export function mountButton(
  spot: Spot,
  onPress: (item: InpageItem, control: ButtonControl) => void,
  mode: ShadowRootMode = 'closed',
): ButtonControl {
  const host = document.createElement('span');
  host.setAttribute(MARK, 'button');
  pin(host, {
    all: 'initial',
    display: 'inline-block',
    'vertical-align': 'middle',
    'max-width': '100%',
    'margin-inline-start': '6px',
    'line-height': 'normal',
  });
  const root = attach(host, mode, BUTTON_CSS);
  const label = el('span', { className: 'label' });
  const button = el('button', { className: 'tc-add', testId: 'tc-add' });
  button.type = 'button';
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  button.append(logo(), label);
  const title = spot.item.paper.title.slice(0, 160);
  const control: ButtonControl = {
    host,
    button,
    setState(state) {
      button.dataset.state = state;
      label.textContent = LABELS[state];
      button.setAttribute('aria-label', title ? `${LABELS[state]}: ${title}` : LABELS[state]);
    },
  };
  control.setState('idle');
  button.addEventListener('click', (event) => {
    // The page's own click handlers (a result's tracking, a row's menu) never see it.
    event.preventDefault();
    event.stopPropagation();
    onPress(spot.item, control);
  });
  root.append(button);
  if (spot.where === 'after') spot.anchor.after(host);
  else spot.anchor.append(host);
  return control;
}

// ---- The card ----------------------------------------------------------------------------------------

export type CardDeps = {
  /** A request to the service worker. */
  ask: <T>(request: Request) => Promise<Reply<T>>;
  /** `chrome.storage.local`: the last thesis and collection, shared with the popup. */
  storage: {
    get(keys: string[]): Promise<Record<string, unknown>>;
    set(values: Record<string, unknown>): Promise<void>;
  };
  /** Where Thesis Copilot opens, for its links. */
  webUrl: string;
  mode?: ShadowRootMode;
};

export type Card = {
  open(item: InpageItem, from: ButtonControl | null): void;
  close(): void;
  /** The card's host while it is open. */
  readonly host: HTMLElement | null;
};

const ORIGIN: Record<InpageItem['origin'], string> = {
  article: 'This page',
  scholar: 'Google Scholar result',
  pubmed: 'PubMed result',
  arxiv: 'arXiv result',
  mdpi: 'MDPI result',
};

const FOUND_IN: Record<Preview['kind'], string> = {
  doi: 'Crossref',
  arxiv: 'arXiv',
  pmid: 'PubMed',
};

const count = (n: number): string => n.toLocaleString('en');

/** The rows of facts the card shows: only those the page or the lookup actually stated. */
export function factRows(item: InpageItem, preview: Preview | null): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  if (item.facts.citedBy !== null) {
    rows.push(['Cited by', `${count(item.facts.citedBy)} on Google Scholar`]);
  } else if (preview?.citedBy !== null && preview?.citedBy !== undefined) {
    rows.push(['Cited by', `${count(preview.citedBy)} (Crossref)`]);
  }
  if (preview?.openAccessVia === 'arXiv') rows.push(['Access', 'Open access on arXiv']);
  else if (preview?.openAccessVia === 'PubMed Central')
    rows.push(['Access', 'Free in PubMed Central']);
  else if (item.facts.access) rows.push(['Access', item.facts.access]);
  if (item.facts.pdfOnPage) rows.push(['PDF', 'Found on this page']);
  return rows;
}

/**
 * What the saved card says about the PDF. A paper free on arXiv or in PubMed Central has its full
 * text fetched by the library itself (seen 2026-10-10: both "Full text" within seconds), so the
 * student is not sent to fetch it; any other PDF the page links is the student's to attach.
 */
export function pdfLine(item: InpageItem, preview: Preview | null): string | null {
  const via =
    preview?.openAccessVia ??
    (item.facts.access === 'Free in PubMed Central' ? 'PubMed Central' : null);
  if (via) return `Its free full text is fetched from ${via}.`;
  if (!item.facts.pdfOnPage) return null;
  return 'The PDF is not attached yet: open it and click the Thesis Copilot toolbar button, or use “Add a PDF” in the library.';
}

/**
 * Below this window width the card is a sheet along the bottom, not a card at the top right: a
 * 360 px card on a phone covers the first results, the one being saved among them (2026-10-09).
 */
export const SHEET_BELOW_PX = 640;

/** Room kept between the result being saved and the sheet's top edge, in px. */
const CLEARANCE_PX = 12;

/** The part of the window the sheet leaves free, top and bottom in viewport px. */
export type Clear = { from: number; to: number };

/** What the sheet leaves free: above it on the bottom edge, below it on the top edge. */
export function clearOf(
  edge: 'bottom' | 'top',
  sheet: { top: number; bottom: number },
  windowHeight: number,
): Clear {
  return edge === 'bottom'
    ? { from: CLEARANCE_PX, to: sheet.top - CLEARANCE_PX }
    : { from: sheet.bottom + CLEARANCE_PX, to: windowHeight - CLEARANCE_PX };
}

/**
 * How far to scroll the page (positive: down the page) so the result at `target` (its button's
 * box) is inside `clear`; 0 when it already is.
 */
export function scrollToClear(target: { top: number; bottom: number }, clear: Clear): number {
  if (target.bottom > clear.to) return target.bottom - clear.to;
  if (target.top < clear.from) return target.top - clear.from;
  return 0;
}

export function createCard(deps: CardDeps): Card {
  let host: HTMLElement | null = null;
  let root: ShadowRoot | null = null;
  let body: HTMLElement | null = null;
  let panel: HTMLElement | null = null;
  let sheet = false;
  /** The sheet's edge; the top once the page could not scroll the result clear of the bottom. */
  let edge: 'bottom' | 'top' = 'bottom';
  let view: CardView = cardInitial;
  let item: InpageItem | null = null;
  let from: ButtonControl | null = null;
  /** Which opening the answers belong to: an answer for a closed or replaced card is dropped. */
  let run = 0;
  const ctx = {
    documentId: '',
    collectionId: '',
    collections: [] as Collection[],
    collectionsFor: '',
  };

  const dispatch = (event: CardEvent) => {
    view = reduceCard(view, event);
    draw();
  };

  const remembered = async (keys: string[]): Promise<Record<string, unknown>> => {
    try {
      return await deps.storage.get(keys);
    } catch {
      return {};
    }
  };

  function ensureHost(): void {
    if (host) return;
    host = document.createElement('div');
    host.setAttribute(MARK, 'card');
    pin(host, {
      all: 'initial',
      position: 'fixed',
      'z-index': '2147483647',
      display: 'block',
    });
    root = attach(host, deps.mode ?? 'closed', CARD_CSS);
    const close = el('button', { className: 'close', text: '×', testId: 'tc-close', fid: 'close' });
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => api.close());
    body = el('div', { className: 'body' });
    panel = el(
      'div',
      { className: 'panel', testId: 'tc-card' },
      el(
        'div',
        { className: 'top' },
        logo(),
        el('span', { className: 'wordmark', text: 'Thesis Copilot' }),
        close,
      ),
      body,
    );
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Add to Thesis Copilot');
    for (const type of ['keydown', 'keyup', 'keypress'] as const) {
      panel.addEventListener(type, (event) => {
        if (type === 'keydown' && (event as KeyboardEvent).key === 'Escape') {
          event.preventDefault();
          api.close();
        }
        // The page's keyboard shortcuts do not fire while the student uses the card.
        event.stopPropagation();
      });
    }
    root.append(panel);
    document.documentElement.append(host);
    place();
    window.addEventListener('resize', onResize);
  }

  /** A card at the top right, or on a narrow window a sheet along the bottom. */
  function place(): void {
    if (!host || !panel) return;
    sheet = window.innerWidth < SHEET_BELOW_PX;
    pin(
      host,
      sheet
        ? {
            top: edge === 'top' ? '0' : 'auto',
            right: '0',
            bottom: edge === 'top' ? 'auto' : '0',
            left: '0',
            width: '100%',
            'max-width': '100%',
          }
        : {
            top: '16px',
            right: '16px',
            bottom: 'auto',
            left: 'auto',
            width: '360px',
            'max-width': 'calc(100% - 32px)',
          },
    );
    panel.classList.toggle('sheet', sheet);
    panel.classList.toggle('at-top', sheet && edge === 'top');
  }

  /**
   * On a narrow window the sheet covers up to half of it: the page is scrolled so the result
   * being saved stays in sight beside it. When the page cannot scroll that far (the last result
   * on a short page), the sheet moves to the top edge for the rest of this opening. Run after
   * every redraw, since the sheet grows as the card fills in; a result already clear of it is
   * left where it is.
   */
  function keepResultInSight(): void {
    if (!sheet || !host || !from?.host.isConnected) return;
    // Not laid out (a hidden tab, or no layout at all): nothing to measure against.
    if (host.getBoundingClientRect().height === 0) return;
    const target = from.host;
    const scrollClear = (): number => {
      const by = scrollToClear(
        target.getBoundingClientRect(),
        clearOf(edge, (host as HTMLElement).getBoundingClientRect(), window.innerHeight),
      );
      if (by !== 0) window.scrollBy({ top: by, left: 0, behavior: 'instant' as ScrollBehavior });
      return scrollToClear(
        target.getBoundingClientRect(),
        clearOf(edge, (host as HTMLElement).getBoundingClientRect(), window.innerHeight),
      );
    };
    if (scrollClear() !== 0 && edge === 'bottom') {
      edge = 'top';
      place();
      scrollClear();
    }
  }

  function onResize(): void {
    place();
    keepResultInSight();
  }

  function focusFid(fid: string): void {
    const node = root?.querySelector<HTMLElement>(`[data-fid="${fid}"]`);
    if (node && !(node as HTMLButtonElement).disabled) node.focus();
  }

  /** Moves the keyboard on as the card fills in — unless the student has already moved it. */
  function settle(fid: string): void {
    const current = (root?.activeElement as HTMLElement | null)?.dataset?.fid;
    if (!current || current === 'close') focusFid(fid);
  }

  async function load(r: number): Promise<void> {
    const reply = await deps.ask<Thesis[]>({ type: 'theses' });
    if (r !== run || !item) return;
    if (reply.ok && reply.value.length) {
      const stored = await remembered(['lastDocumentId']);
      if (r !== run) return;
      ctx.documentId = reply.value.some((t) => t.id === stored.lastDocumentId)
        ? (stored.lastDocumentId as string)
        : (reply.value[0] as Thesis).id;
    }
    dispatch({ type: 'theses', reply, hasRefs: item.refs.length > 0 });
    if (view.kind !== 'ready') {
      settle(view.kind === 'unreachable' ? 'retry' : 'site');
      return;
    }
    settle('save');
    void loadCollections(r);
    if (item.refs.length) void lookup(r, item.refs);
  }

  async function loadCollections(r: number): Promise<void> {
    const documentId = ctx.documentId;
    ctx.collections = [];
    ctx.collectionsFor = '';
    const reply = await deps.ask<Collection[]>({ type: 'collections', documentId });
    if (r !== run || documentId !== ctx.documentId) return;
    ctx.collections = reply.ok ? reply.value : [];
    ctx.collectionsFor = documentId;
    if (!ctx.collections.some((c) => c.id === ctx.collectionId)) {
      const stored = await remembered(['lastCollectionId']);
      if (r !== run || documentId !== ctx.documentId) return;
      ctx.collectionId = ctx.collections.some((c) => c.id === stored.lastCollectionId)
        ? (stored.lastCollectionId as string)
        : '';
    }
    draw();
  }

  async function lookup(r: number, refs: PaperRef[]): Promise<void> {
    let message = '';
    for (const ref of refs) {
      const reply = await deps.ask<Preview>({ type: 'lookup', documentId: ctx.documentId, ref });
      if (r !== run) return;
      if (reply.ok) {
        dispatch({ type: 'lookup', lookup: { state: 'found', ref, preview: reply.value } });
        settle('save');
        return;
      }
      if (reply.status === 401) {
        dispatch({ type: 'signed-out' });
        settle('site');
        return;
      }
      message = reply.message;
    }
    dispatch({ type: 'lookup', lookup: { state: 'not-found', message } });
    settle('save');
  }

  async function save(): Promise<void> {
    if (!item || !canSave(view)) return;
    const job: SaveOneJob = {
      documentId: ctx.documentId,
      collectionId: ctx.collectionId || null,
      ref: saveRef(view),
      paper: item.paper,
    };
    const r = run;
    const control = from;
    dispatch({ type: 'save-start' });
    void deps.storage.set({ lastDocumentId: job.documentId }).catch(() => undefined);
    const saved = item;
    const found = view.kind === 'ready' && view.lookup.state === 'found' ? view.lookup : null;
    const reply = await deps.ask<SaveOneResult>({ type: 'save-one', job });
    // The button says so even when the card was closed while it saved.
    if (reply.ok && reply.value.status !== 'failed') {
      control?.setState(reply.value.status);
      void rememberSaved(deps, job.documentId, [
        ...paperKeys({ refs: saved.refs, doi: saved.paper.doi, title: saved.paper.title }),
        ...(found ? paperKeys({ refs: [found.ref], doi: found.preview.doi }) : []),
      ]);
    }
    if (r !== run) return;
    dispatch({ type: 'save-done', reply });
    focusFid(view.kind === 'ready' && view.result?.sourceId ? 'open-source' : 'save');
  }

  // ---- Drawing --------------------------------------------------------------------------------------

  function paperSection(current: InpageItem): HTMLElement {
    const lookupState = view.kind === 'ready' ? view.lookup : null;
    const preview = lookupState?.state === 'found' ? lookupState.preview : null;
    const { paper } = current;
    const details = (
      preview
        ? [preview.byline, preview.year, preview.venue]
        : [paper.byline, paper.year, paper.venue]
    )
      .filter((part) => part !== null && part !== undefined && part !== '')
      .join(' · ');
    const ref = lookupState?.state === 'found' ? lookupState.ref : current.refs[0];
    const section = el(
      'section',
      { testId: 'tc-paper' },
      el('p', { className: 'eyebrow', text: ORIGIN[current.origin] }),
      el('p', { className: 'title', text: preview?.title || paper.title || 'Untitled paper' }),
      details ? el('p', { className: 'byline', text: details }) : null,
      el('p', {
        className: 'id',
        text: ref ? refLabel(ref) : 'No DOI on this result — it will be matched by its title.',
      }),
    );
    if (lookupState?.state === 'looking') {
      section.append(spinnerLine('Looking it up…'));
    } else if (lookupState?.state === 'found' && preview) {
      section.append(
        el('p', { className: 'status ok', text: `✓ Details found in ${FOUND_IN[preview.kind]}` }),
      );
    } else if (lookupState?.state === 'not-found') {
      section.append(
        el('p', {
          className: 'status muted',
          text: paper.doi
            ? 'No record found for it yet — it will be saved by its DOI and details.'
            : 'No record found for it — it will be saved by its details and matched in the library.',
        }),
      );
    }
    const rows = factRows(current, preview);
    if (rows.length) {
      const list = el('dl', { className: 'facts', testId: 'tc-facts' });
      for (const [term, value] of rows)
        list.append(el('dt', { text: term }), el('dd', { text: value }));
      section.append(list);
    }
    return section;
  }

  function pickers(theses: Thesis[], locked: boolean): HTMLElement {
    const thesis = el('select', { testId: 'tc-thesis', fid: 'thesis' });
    thesis.id = 'tc-thesis';
    for (const t of theses) {
      const option = el('option', { text: t.title || 'Untitled thesis' });
      option.value = t.id;
      thesis.append(option);
    }
    thesis.value = ctx.documentId;
    thesis.disabled = locked;
    thesis.addEventListener('change', () => {
      ctx.documentId = thesis.value;
      ctx.collectionId = '';
      void deps.storage.set({ lastDocumentId: thesis.value }).catch(() => undefined);
      void loadCollections(run);
      draw();
    });
    const thesisLabel = el('label', { text: 'Save to' });
    thesisLabel.htmlFor = 'tc-thesis';

    const collection = el('select', { testId: 'tc-collection', fid: 'collection' });
    collection.id = 'tc-collection';
    const none = el('option', { text: 'No collection' });
    none.value = '';
    collection.append(none);
    for (const c of ctx.collectionsFor === ctx.documentId ? ctx.collections : []) {
      const option = el('option', { text: `${c.name} (${c.count})` });
      option.value = c.id;
      collection.append(option);
    }
    collection.value = ctx.collectionId;
    collection.disabled = locked;
    collection.addEventListener('change', () => {
      ctx.collectionId = collection.value;
      void deps.storage.set({ lastCollectionId: collection.value }).catch(() => undefined);
    });
    const collectionLabel = el('label', { text: 'Collection (optional)' });
    collectionLabel.htmlFor = 'tc-collection';

    return el(
      'div',
      { className: 'fields' },
      el('div', { className: 'field' }, thesisLabel, thesis),
      el('div', { className: 'field' }, collectionLabel, collection),
    );
  }

  const docPath = (documentId: string) => `${deps.webUrl}/app/d/${encodeURIComponent(documentId)}`;

  function readyNodes(v: Extract<CardView, { kind: 'ready' }>, current: InpageItem): Node[] {
    const result = v.result;
    const saving = v.phase === 'saving';
    const title = v.theses.find((t) => t.id === ctx.documentId)?.title || 'your thesis';
    const failed =
      v.error ?? (result?.status === 'failed' ? (result.message ?? 'It was not saved.') : null);

    if (v.phase === 'done' && result && !failed) {
      const lines: string[] = [];
      if (result.status === 'saved') {
        lines.push(
          result.via === 'details' && !current.paper.doi
            ? 'It is being matched by its title now. If no record matches, it stays in the library for you to fix.'
            : 'It is being looked up and read now, and appears in the library in a moment.',
        );
      }
      const named = ctx.collections.find((c) => c.id === ctx.collectionId);
      if (result.collection === 'added' && named) lines.push(`Filed in “${named.name}”.`);
      if (result.status === 'saved') {
        const lookupState = v.lookup;
        const pdf = pdfLine(current, lookupState.state === 'found' ? lookupState.preview : null);
        if (pdf) lines.push(pdf);
      }
      const nodes: Node[] = [
        result.status === 'saved'
          ? notice('ok', `Saved to “${title}”`, ...lines)
          : notice('note', `Already in the library of “${title}”`, ...lines),
      ];
      if (result.collection === 'failed') {
        nodes.push(notice('warn', 'Worth knowing', 'It could not be put in the collection.'));
      }
      const actions = el('div', { className: 'actions' });
      if (result.sourceId) {
        actions.append(
          siteLink(
            'Open in Thesis Copilot',
            `${docPath(ctx.documentId)}/sources/${encodeURIComponent(result.sourceId)}`,
            { fid: 'open-source', testId: 'tc-open-source' },
          ),
        );
      }
      actions.append(
        siteLink('Open the library', `${docPath(ctx.documentId)}/sources`, {
          secondary: true,
          fid: 'open-library',
        }),
      );
      nodes.push(actions);
      return nodes;
    }

    const nodes: Node[] = [pickers(v.theses, saving)];
    if (failed) nodes.push(notice('error', 'Not saved', failed));
    const looking = v.lookup.state === 'looking';
    const label = saving ? 'Saving…' : failed ? 'Try again' : 'Save to library';
    const primary = el('button', { className: 'btn', text: label, testId: 'tc-save', fid: 'save' });
    primary.type = 'button';
    primary.disabled = saving || looking;
    primary.setAttribute('aria-busy', String(saving));
    if (saving) primary.prepend(el('span', { className: 'spinner' }));
    primary.addEventListener('click', () => void save());
    nodes.push(el('div', { className: 'actions' }, primary));
    return nodes;
  }

  function draw(): void {
    if (!body || !item) return;
    const current = item;
    const focused = (root?.activeElement as HTMLElement | null)?.dataset?.fid;
    const nodes: Node[] = [paperSection(current)];
    switch (view.kind) {
      case 'loading':
        nodes.push(spinnerLine('Finding your theses…'));
        break;
      case 'signed-out':
        nodes.push(
          notice(
            'note',
            'Sign in to Thesis Copilot',
            'The add-on uses your Thesis Copilot sign-in in this browser. Sign in, then press the button again.',
          ),
          el(
            'div',
            { className: 'actions' },
            siteLink('Sign in to Thesis Copilot', `${deps.webUrl}/sign-in`, { fid: 'site' }),
          ),
        );
        break;
      case 'no-thesis':
        nodes.push(
          notice(
            'note',
            'Start a thesis first',
            'Papers are saved into a thesis library. Start one, then press the button again.',
          ),
          el(
            'div',
            { className: 'actions' },
            siteLink('Start a thesis', `${deps.webUrl}/app/new`, { fid: 'site' }),
          ),
        );
        break;
      case 'unreachable': {
        const retry = el('button', {
          className: 'btn',
          text: 'Try again',
          fid: 'retry',
          testId: 'tc-retry',
        });
        retry.type = 'button';
        retry.addEventListener('click', () => {
          dispatch({ type: 'retry' });
          void load(run);
        });
        nodes.push(
          notice('error', 'Could not reach Thesis Copilot', view.message),
          el('div', { className: 'actions' }, retry),
        );
        break;
      }
      case 'ready':
        nodes.push(...readyNodes(view, current));
        break;
    }
    body.replaceChildren(...nodes);
    body.setAttribute(
      'aria-busy',
      String(view.kind === 'loading' || (view.kind === 'ready' && view.phase === 'saving')),
    );
    if (focused) focusFid(focused);
    keepResultInSight();
  }

  const api: Card = {
    open(next, control) {
      from?.button.setAttribute('aria-expanded', 'false');
      from = control;
      control?.button.setAttribute('aria-expanded', 'true');
      item = next;
      run += 1;
      view = cardInitial;
      // Each opening starts on the bottom edge, for whichever result it is.
      edge = 'bottom';
      ensureHost();
      place();
      draw();
      focusFid('close');
      void load(run);
    },
    close() {
      run += 1;
      window.removeEventListener('resize', onResize);
      host?.remove();
      host = null;
      root = null;
      body = null;
      panel = null;
      item = null;
      view = cardInitial;
      const back = from;
      from = null;
      back?.button.setAttribute('aria-expanded', 'false');
      back?.button.focus();
    },
    get host() {
      return host;
    },
  };
  return api;
}

// ---- What this add-on saved before (memory.ts) ------------------------------------------------------

async function rememberSaved(deps: CardDeps, documentId: string, keys: string[]): Promise<void> {
  if (!keys.length) return;
  try {
    const stored = await deps.storage.get([SAVED_KEY]);
    await deps.storage.set({ [SAVED_KEY]: remember(stored[SAVED_KEY], documentId, keys) });
  } catch {
    // Only the button's label on a later visit depends on it.
  }
}

/** Buttons for papers already saved into the current thesis from this browser say so. */
async function markSaved(
  deps: CardDeps,
  mounted: Array<{ item: InpageItem; control: ButtonControl }>,
): Promise<void> {
  let stored: Record<string, unknown>;
  try {
    stored = await deps.storage.get(['lastDocumentId', SAVED_KEY]);
  } catch {
    return;
  }
  const documentId = stored.lastDocumentId;
  if (typeof documentId !== 'string') return;
  for (const { item, control } of mounted) {
    const keys = paperKeys({ refs: item.refs, doi: item.paper.doi, title: item.paper.title });
    if (control.button.dataset.state === 'idle' && wasSaved(stored[SAVED_KEY], documentId, keys)) {
      control.setState('saved');
    }
  }
}

// ---- Running on the page ---------------------------------------------------------------------------

/**
 * Puts the buttons in, and again when the page adds results (PubMed's "Show more"). Our own
 * buttons going in are not news, so the page is not rescanned for them.
 */
export function startInpage(deps: CardDeps, url: () => string = () => location.href) {
  const card = createCard(deps);
  const done = new WeakSet<Element>();
  const scan = (): number => {
    const mounted: Array<{ item: InpageItem; control: ButtonControl }> = [];
    for (const spot of findSpots(url())) {
      if (done.has(spot.node)) continue;
      done.add(spot.node);
      const control = mountButton(spot, (item, c) => card.open(item, c), deps.mode);
      mounted.push({ item: spot.item, control });
    }
    if (mounted.length) void markSaved(deps, mounted);
    return mounted.length;
  };
  scan();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ours = (node: Node) => node instanceof Element && node.hasAttribute(MARK);
  const observer = new MutationObserver((records) => {
    const news = records.some((record) =>
      Array.from(record.addedNodes).some((node) => !ours(node)),
    );
    if (!news) return;
    clearTimeout(timer);
    timer = setTimeout(scan, 400);
  });
  observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true });
  return {
    scan,
    card,
    stop() {
      observer.disconnect();
      clearTimeout(timer);
      card.close();
    },
  };
}
