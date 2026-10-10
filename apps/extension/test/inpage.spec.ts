// @vitest-environment jsdom
/**
 * The in-page buttons and their card (ADR-0125), against hand-written structural fixtures (see
 * the comment at the top of each) and a fake service worker. Nothing here requests a live site.
 *
 * Pinned:
 * - the right item: an article page's button saves the article its own tags name, and sits beside
 *   that article's DOI link — not a hidden copy, not a reference's; an MDPI issue's contents and a
 *   Scholar robot check get no button; every result of a results page gets its own;
 * - only the identifier is sent to look a paper up, and the import goes in by the identifier the
 *   lookup found a record for (DOI, then PMID), else by the paper's details;
 * - the card shows "Cited by", access and "PDF found" only when the page or the lookup said so;
 * - nothing fails silently: a refusal's reason is written out, with Try again;
 * - the page cannot reach in (closed shadow roots), and the button and card cannot push the
 *   page's layout about (an inline box that may shrink; a fixed card within the window).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type ButtonControl,
  type CardDeps,
  clearOf,
  createCard,
  factRows,
  findSpots,
  type InpageItem,
  mountButton,
  SHEET_BELOW_PX,
  scrollToClear,
  shadowOf,
  startInpage,
} from '../src/inpage.js';
import type { Preview, Reply, Request, SaveOneJob, SaveOneResult } from '../src/messages.js';

const WEB = 'https://thesis.rademics.ai';
const DOC = '0190a3c4-0000-7000-8000-000000000001';
const SOURCE = '0190a3c4-0000-7000-8000-000000000101';

function load(name: string): void {
  const html = readFileSync(join(process.cwd(), 'test', 'fixtures', name), 'utf8');
  document.documentElement.innerHTML = new DOMParser().parseFromString(
    html,
    'text/html',
  ).documentElement.innerHTML;
}

const settle = async (rounds = 6) => {
  for (let i = 0; i < rounds; i += 1) await new Promise((done) => setTimeout(done, 0));
};

const PREVIEW: Preview = {
  kind: 'doi',
  title: 'Groundwater Recharge in Hard-Rock Aquifers of South India',
  byline: 'Kavya Raman, Sanjay Iyer',
  year: 2017,
  venue: 'Open Journal of Groundwater Studies',
  doi: '10.5555/ojgs14121570',
  citedBy: 54,
  openAccessVia: null,
};

type Answers = Partial<
  Record<Request['type'], (request: Request) => Reply<unknown> | Promise<Reply<unknown>>>
>;

function fake(answers: Answers = {}) {
  const asked: Request[] = [];
  const stored: Record<string, unknown> = {};
  const deps: CardDeps = {
    ask: async <T>(request: Request) => {
      asked.push(request);
      const answer = answers[request.type];
      return (await (answer
        ? answer(request)
        : { ok: false, status: 500, message: 'Not answered in this test.' })) as Reply<T>;
    },
    storage: {
      get: async (keys) =>
        Object.fromEntries(keys.filter((k) => k in stored).map((k) => [k, stored[k]])),
      set: async (values) => {
        Object.assign(stored, values);
      },
    },
    webUrl: WEB,
    mode: 'closed',
  };
  return { deps, asked, stored };
}

const signedIn: Answers = {
  theses: () => ({ ok: true, value: [{ id: DOC, title: 'Groundwater in Tamil Nadu' }] }),
  collections: () => ({ ok: true, value: [] }),
};

const saved = (over: Partial<SaveOneResult> = {}): Reply<SaveOneResult> => ({
  ok: true,
  value: {
    key: 'one',
    status: 'saved',
    sourceId: SOURCE,
    collection: null,
    signedOut: false,
    via: 'id',
    ...over,
  },
});

/** The card's shadow root (closed: only the test's back door reaches it). */
function cardRoot(host: HTMLElement | null): ShadowRoot {
  const root = host ? shadowOf(host) : null;
  if (!root) throw new Error('the card is not open');
  return root;
}

const q = (root: ShadowRoot, testId: string) =>
  root.querySelector<HTMLElement>(`[data-testid="${testId}"]`);

const press = (control: ButtonControl) => control.button.click();

afterEach(() => {
  document.documentElement.innerHTML = '<head></head><body></body>';
});

// ---- Where the buttons go ------------------------------------------------------------------------

describe('an article page', () => {
  it('MDPI: one button, beside the article’s own visible DOI link, saving that article', () => {
    load('mdpi-article.html');
    const spots = findSpots('https://www.mdpi.com/1660-0000/14/12/1570');
    expect(spots).toHaveLength(1);
    const [spot] = spots;
    expect(spot?.where).toBe('after');
    // Not the hidden "cite" box's copy, and not a reference's DOI.
    expect(spot?.anchor.closest('.bib-identity')).not.toBeNull();
    expect(spot?.item.refs).toEqual([{ kind: 'doi', id: '10.5555/ojgs14121570' }]);
    expect(spot?.item.paper).toMatchObject({
      title: 'Groundwater Recharge in Hard-Rock Aquifers of South India',
      doi: '10.5555/ojgs14121570',
      year: '2017',
    });
    expect(spot?.item.facts).toEqual({ citedBy: null, pdfOnPage: true, access: null });
  });

  it('MDPI issue: no button at all — it lists articles and is none itself', () => {
    load('mdpi-issue.html');
    expect(findSpots('https://www.mdpi.com/1660-0000/14/12')).toEqual([]);
  });

  it('arXiv abstract: beside the arXiv DOI link, saving the e-print by its arXiv id', () => {
    load('arxiv-abstract.html');
    const [spot, ...rest] = findSpots('https://arxiv.org/abs/2610.00001v2');
    expect(rest).toEqual([]);
    expect(spot?.anchor.id).toBe('arxiv-doi-link');
    expect(spot?.item.refs).toEqual([{ kind: 'arxiv', id: '2610.00001' }]);
    expect(spot?.item.facts.pdfOnPage).toBe(true);
  });

  it('PubMed article: beside its DOI link, by DOI then PMID; under the title when no DOI', () => {
    load('pubmed-article.html');
    const [spot, ...rest] = findSpots('https://pubmed.ncbi.nlm.nih.gov/33333333/');
    expect(rest).toEqual([]);
    expect(spot?.anchor.classList.contains('id-link')).toBe(true);
    expect(spot?.item.refs).toEqual([
      { kind: 'doi', id: '10.5555/ohn.2021.0856' },
      { kind: 'pmid', id: '33333333' },
    ]);

    // The same record with no DOI anywhere: named by the PMID in its address alone.
    for (const node of Array.from(
      document.querySelectorAll('meta[name="citation_doi"], .identifier.doi'),
    ))
      node.remove();
    const [bare] = findSpots('https://pubmed.ncbi.nlm.nih.gov/33333333/');
    expect(bare?.anchor.tagName).toBe('H1');
    expect(bare?.item.refs).toEqual([{ kind: 'pmid', id: '33333333' }]);
  });
});

describe('a results page', () => {
  it('Google Scholar: a button in each result’s row of links, with what Scholar shows', () => {
    load('scholar-buttons.html');
    const spots = findSpots('https://scholar.google.com/scholar?q=groundwater');
    expect(spots).toHaveLength(4);
    expect(spots.map((s) => s.item.paper.title)).toEqual([
      'Variational inference: a review for statisticians',
      'Attention is all you need',
      'Heat stress among outdoor workers in Chennai',
      'Groundwater markets in South India',
    ]);
    // Each result's own identifier: a DOI in its link, an arXiv id, a PubMed id, or none.
    expect(spots.map((s) => s.item.refs)).toEqual([
      [{ kind: 'doi', id: '10.1080/01621459.2017.1285773' }],
      [{ kind: 'arxiv', id: '1706.03762' }],
      [{ kind: 'pmid', id: '33333333' }],
      [],
    ]);
    expect(spots.map((s) => s.item.facts)).toEqual([
      { citedBy: 1234, pdfOnPage: false, access: null },
      { citedBy: 150000, pdfOnPage: true, access: null },
      { citedBy: null, pdfOnPage: false, access: null },
      { citedBy: null, pdfOnPage: false, access: null },
    ]);
    // In the row with Save · Cite · Cited by — not the PDF box, also a .gs_fl.
    expect(spots[1]?.anchor.classList.contains('gs_flb')).toBe(true);
    expect(spots[1]?.where).toBe('append');
    // A citation-only record has no row of links: the button follows its byline.
    expect(spots[3]?.anchor.classList.contains('gs_a')).toBe(true);
    expect(spots[3]?.where).toBe('after');
  });

  it('Google Scholar robot check: no results, so no buttons, and nothing is touched', () => {
    document.documentElement.innerHTML =
      '<head><title>Google Scholar</title></head><body><div id="gs_captcha_ccl"><h1>Please show you&#39;re not a robot</h1><form id="gs_captcha_f"><div class="g-recaptcha"></div></form></div></body>';
    const before = document.body.innerHTML;
    expect(findSpots('https://scholar.google.com/scholar?q=groundwater')).toEqual([]);
    startInpage(fake().deps, () => 'https://scholar.google.com/scholar?q=groundwater').stop();
    expect(document.body.innerHTML).toBe(before);
  });

  it('PubMed: a button on each result’s citation line, by DOI or by PMID', () => {
    load('pubmed-results.html');
    const spots = findSpots('https://pubmed.ncbi.nlm.nih.gov/?term=soil+salinity');
    expect(spots.length).toBeGreaterThanOrEqual(4);
    expect(spots[0]?.anchor.classList.contains('docsum-citation')).toBe(true);
    expect(spots[0]?.item.refs).toEqual([
      { kind: 'doi', id: '10.1007/s10661-024-00001-x' },
      { kind: 'pmid', id: '11111111' },
    ]);
    // No DOI on the record: imported by its PMID, which the library reads from PubMed.
    expect(spots[1]?.item.refs).toEqual([{ kind: 'pmid', id: '22222222' }]);
  });

  it('arXiv: a button on each listing entry and each search result', () => {
    load('arxiv-list.html');
    const listing = findSpots('https://arxiv.org/list/cs.CL/recent');
    expect(listing.map((s) => s.item.refs[0])).toEqual([
      { kind: 'arxiv', id: '2610.00001' },
      { kind: 'arxiv', id: '2610.00002' },
      { kind: 'arxiv', id: 'hep-th/9901001' },
    ]);
    expect(listing[0]?.anchor.tagName).toBe('DT');
    expect(listing.map((s) => s.item.facts.pdfOnPage)).toEqual([true, false, false]);

    load('arxiv-search.html');
    const search = findSpots('https://arxiv.org/search/?query=crop&searchtype=all');
    expect(search[0]?.anchor.classList.contains('list-title')).toBe(true);
    expect(search[0]?.item.refs).toEqual([{ kind: 'arxiv', id: '2609.12345' }]);
  });
});

// ---- The button ------------------------------------------------------------------------------------

describe('the button', () => {
  it('lives in a closed shadow root the page cannot read, as an inline box that may shrink', () => {
    load('mdpi-article.html');
    const [spot] = findSpots('https://www.mdpi.com/1660-0000/14/12/1570');
    if (!spot) throw new Error('no spot');
    const control = mountButton(spot, () => undefined);
    expect(control.host.shadowRoot).toBeNull();
    expect(spot.anchor.nextElementSibling).toBe(control.host);
    expect(control.button.textContent).toBe('Add to Thesis Copilot');
    expect(control.button.getAttribute('aria-label')).toBe(
      'Add to Thesis Copilot: Groundwater Recharge in Hard-Rock Aquifers of South India',
    );
    expect(control.host.style.getPropertyValue('display')).toBe('inline-block');
    expect(control.host.style.getPropertyPriority('display')).toBe('important');
    expect(control.host.style.getPropertyValue('max-width')).toBe('100%');
  });

  it('is put once per result, and on results the page adds later', async () => {
    load('pubmed-results.html');
    const url = () => 'https://pubmed.ncbi.nlm.nih.gov/?term=soil+salinity';
    const run = startInpage(fake().deps, url);
    const count = () => document.querySelectorAll('[data-tc-addon="button"]').length;
    const first = count();
    expect(first).toBe(findSpots(url()).length);
    expect(run.scan()).toBe(0);
    expect(count()).toBe(first);

    // "Show more": the page appends a result.
    const list = document.querySelector('.search-results-list');
    const more = document.createElement('article');
    more.className = 'full-docsum';
    more.innerHTML =
      '<div class="docsum-content"><a class="docsum-title" href="/55555555/" data-article-id="55555555">Added later.</a><div class="docsum-citation full-citation"><span class="docsum-journal-citation full-journal-citation">J Test. 2020.</span></div></div>';
    list?.append(more);
    // Waits for the observer rather than a fixed 500 ms: a loaded CI runner took longer (2026-10-09).
    await vi.waitFor(() => expect(count()).toBe(first + 1), { timeout: 3000, interval: 50 });
    expect(more.querySelector('[data-tc-addon="button"]')).not.toBeNull();
    run.stop();
  });
});

// ---- The card ---------------------------------------------------------------------------------------

function openArticle(answers: Answers) {
  load('mdpi-article.html');
  const [spot] = findSpots('https://www.mdpi.com/1660-0000/14/12/1570');
  if (!spot) throw new Error('no spot');
  const { deps, asked, stored } = fake(answers);
  const card = createCard(deps);
  const control = mountButton(spot, (item, from) => card.open(item, from));
  press(control);
  return { card, control, asked, stored, item: spot.item };
}

describe('the card', () => {
  it('shows the record found for the page’s DOI, with only what was said about it, and saves it', async () => {
    const { card, control, asked } = openArticle({
      ...signedIn,
      lookup: () => ({ ok: true, value: PREVIEW }),
      'save-one': () => saved(),
    });
    expect(card.host?.shadowRoot).toBeNull();
    await settle();
    const root = cardRoot(card.host);
    expect(q(root, 'tc-paper')?.textContent).toContain('✓ Details found in Crossref');
    expect(q(root, 'tc-facts')?.textContent).toBe('Cited by54 (Crossref)PDFFound on this page');

    // Only the identifier is sent to look it up.
    const lookup = asked.find((r) => r.type === 'lookup');
    expect(lookup).toEqual({
      type: 'lookup',
      documentId: DOC,
      ref: { kind: 'doi', id: '10.5555/ojgs14121570' },
    });

    q(root, 'tc-save')?.click();
    await settle();
    const job = (asked.find((r) => r.type === 'save-one') as { job: SaveOneJob }).job;
    expect(job).toMatchObject({
      documentId: DOC,
      collectionId: null,
      ref: { kind: 'doi', id: '10.5555/ojgs14121570' },
    });
    expect(q(root, 'tc-message')?.textContent).toContain('Saved to “Groundwater in Tamil Nadu”');
    const open = q(root, 'tc-open-source') as HTMLAnchorElement;
    expect(open.href).toBe(`${WEB}/app/d/${DOC}/sources/${SOURCE}`);
    expect(open.target).toBe('_blank');
    expect(open.rel).toBe('noopener noreferrer');
    expect(control.button.textContent).toBe('Saved to Thesis Copilot');
  });

  it('tries the next identifier when the first has no record, and saves by the one found', async () => {
    load('pubmed-article.html');
    const [spot] = findSpots('https://pubmed.ncbi.nlm.nih.gov/33333333/');
    if (!spot) throw new Error('no spot');
    const { deps, asked } = fake({
      ...signedIn,
      lookup: (request) =>
        (request as { ref: { kind: string } }).ref.kind === 'doi'
          ? { ok: false, status: 404, message: 'No paper with that DOI' }
          : {
              ok: true,
              value: { ...PREVIEW, kind: 'pmid', citedBy: null, openAccessVia: 'PubMed Central' },
            },
      'save-one': () => saved(),
    });
    const card = createCard(deps);
    card.open(spot.item, null);
    await settle();
    const root = cardRoot(card.host);
    expect(q(root, 'tc-paper')?.textContent).toContain('PMID 33333333');
    expect(q(root, 'tc-facts')?.textContent).toBe('AccessFree in PubMed Central');
    q(root, 'tc-save')?.click();
    await settle();
    const job = (asked.find((r) => r.type === 'save-one') as { job: SaveOneJob }).job;
    expect(job.ref).toEqual({ kind: 'pmid', id: '33333333' });
  });

  it('when no record is found, says so and saves by the details, with the DOI', async () => {
    const { card, asked } = openArticle({
      ...signedIn,
      lookup: () => ({ ok: false, status: 404, message: 'No paper with that DOI' }),
      'save-one': () => saved({ via: 'details' }),
    });
    await settle();
    const root = cardRoot(card.host);
    expect(q(root, 'tc-paper')?.textContent).toContain('it will be saved by its DOI and details');
    expect(q(root, 'tc-facts')?.textContent).toBe('PDFFound on this page');
    q(root, 'tc-save')?.click();
    await settle();
    const job = (asked.find((r) => r.type === 'save-one') as { job: SaveOneJob }).job;
    expect(job.ref).toBeNull();
    expect(job.paper.doi).toBe('10.5555/ojgs14121570');
  });

  it('writes out why a save failed, and offers to try again — never a bare “failed”', async () => {
    let calls = 0;
    const { card } = openArticle({
      ...signedIn,
      lookup: () => ({ ok: true, value: PREVIEW }),
      'save-one': () => {
        calls += 1;
        return calls === 1
          ? saved({ status: 'failed', sourceId: null, message: 'That thesis is not yours.' })
          : saved();
      },
    });
    await settle();
    const root = cardRoot(card.host);
    q(root, 'tc-save')?.click();
    await settle();
    expect(q(root, 'tc-message')?.textContent).toBe('Not savedThat thesis is not yours.');
    expect(q(root, 'tc-save')?.textContent).toBe('Try again');
    q(root, 'tc-save')?.click();
    await settle();
    expect(q(root, 'tc-message')?.textContent).toContain('Saved to');
  });

  it('asks a signed-out student to sign in, with a link that opens a new tab', async () => {
    const { card, asked } = openArticle({
      theses: () => ({ ok: false, status: 401, message: 'You are signed out of Thesis Copilot.' }),
    });
    await settle();
    const root = cardRoot(card.host);
    expect(q(root, 'tc-message')?.textContent).toContain('Sign in to Thesis Copilot');
    const link = root.querySelector<HTMLAnchorElement>('a.btn');
    expect(link?.href).toBe(`${WEB}/sign-in`);
    expect(asked.map((r) => r.type)).toEqual(['theses']);
  });

  it('a Scholar result with no identifier is not looked up, and says it is matched by title', async () => {
    load('scholar-buttons.html');
    const spot = findSpots('https://scholar.google.com/scholar?q=groundwater')[3];
    if (!spot) throw new Error('no spot');
    const { deps, asked } = fake({ ...signedIn, 'save-one': () => saved({ via: 'details' }) });
    const card = createCard(deps);
    card.open(spot.item, null);
    await settle();
    const root = cardRoot(card.host);
    expect(q(root, 'tc-paper')?.textContent).toContain('No DOI on this result');
    expect(asked.some((r) => r.type === 'lookup')).toBe(false);
    q(root, 'tc-save')?.click();
    await settle();
    expect(q(root, 'tc-message')?.textContent).toContain('matched by its title');
  });

  it('Escape closes it and gives the keyboard back to the button; a save still finishes', async () => {
    let finish: (reply: Reply<SaveOneResult>) => void = () => undefined;
    // The save answers only after the card is closed.
    const later = new Promise<Reply<SaveOneResult>>((done) => {
      finish = done;
    });
    const { card, control } = openArticle({
      ...signedIn,
      lookup: () => ({ ok: true, value: PREVIEW }),
      'save-one': () => later,
    });
    expect(control.button.getAttribute('aria-expanded')).toBe('true');
    await settle();
    const root = cardRoot(card.host);
    q(root, 'tc-save')?.click();
    await settle();
    const panel = q(root, 'tc-card') as HTMLElement;
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(card.host).toBeNull();
    expect(document.querySelector('[data-tc-addon="card"]')).toBeNull();
    expect(control.button.getAttribute('aria-expanded')).toBe('false');
    expect(shadowOf(control.host)?.activeElement).toBe(control.button);
    // The save the student started still lands, and the button says so.
    finish(saved({ status: 'present' }));
    await settle();
    expect(control.button.textContent).toBe('In your library');
  });

  it('sits fixed in the window, never wider than it, taking no room in the page', async () => {
    const { card } = openArticle(signedIn);
    await settle();
    const host = card.host as HTMLElement;
    expect(host.parentElement).toBe(document.documentElement);
    expect(host.style.getPropertyValue('position')).toBe('fixed');
    expect(host.style.getPropertyValue('width')).toBe('360px');
    expect(host.style.getPropertyValue('max-width')).toBe('calc(100% - 32px)');
    // `!important`, so the page's own CSS cannot move it (jsdom keeps the priority only for some
    // properties; Chrome keeps it for all of them).
    expect(host.style.getPropertyPriority('width')).toBe('important');
    expect(host.style.getPropertyPriority('top')).toBe('important');
  });

  it('on a narrow window is a sheet along the bottom, and becomes a card again when it widens', async () => {
    const wide = window.innerWidth;
    const resize = (width: number) => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
      window.dispatchEvent(new Event('resize'));
    };
    try {
      resize(390);
      const { card } = openArticle(signedIn);
      await settle();
      const host = card.host as HTMLElement;
      const panel = q(cardRoot(host), 'tc-card');
      expect(host.style.getPropertyValue('bottom')).toBe('0px');
      expect(host.style.getPropertyValue('left')).toBe('0px');
      expect(host.style.getPropertyValue('top')).toBe('auto');
      expect(host.style.getPropertyValue('width')).toBe('100%');
      expect(panel?.classList.contains('sheet')).toBe(true);
      resize(SHEET_BELOW_PX);
      expect(host.style.getPropertyValue('top')).toBe('16px');
      expect(host.style.getPropertyValue('width')).toBe('360px');
      expect(panel?.classList.contains('sheet')).toBe(false);
      card.close();
    } finally {
      resize(wide);
    }
  });
});

describe('keeping the result being saved in sight beside the sheet', () => {
  // A 844 px window; a bottom sheet from 500 down, or a top sheet down to 344.
  const below = clearOf('bottom', { top: 500, bottom: 844 }, 844);
  const above = clearOf('top', { top: 0, bottom: 344 }, 844);

  it('on the bottom edge, leaves free what is above the sheet, with room to spare', () => {
    expect(below).toEqual({ from: 12, to: 488 });
    expect(above).toEqual({ from: 356, to: 832 });
  });

  it('scrolls a result under the sheet up until it is clear', () => {
    expect(scrollToClear({ top: 480, bottom: 504 }, below)).toBe(16);
    expect(scrollToClear({ top: 700, bottom: 724 }, below)).toBe(236);
  });

  it('scrolls a result above the window, or under a top sheet, down into the free part', () => {
    expect(scrollToClear({ top: -40, bottom: -16 }, below)).toBe(-52);
    expect(scrollToClear({ top: 300, bottom: 324 }, above)).toBe(-56);
  });

  it('leaves a result that is already in sight where it is', () => {
    expect(scrollToClear({ top: 200, bottom: 224 }, below)).toBe(0);
    expect(scrollToClear({ top: 12, bottom: 36 }, below)).toBe(0);
    expect(scrollToClear({ top: 700, bottom: 724 }, above)).toBe(0);
  });
});

describe('the facts the card shows', () => {
  const item = (facts: InpageItem['facts']): InpageItem => ({
    origin: 'scholar',
    paper: { title: 'T', doi: null, reference: 'T' },
    refs: [],
    facts,
  });

  it('are only those the page or the lookup stated, each saying where it came from', () => {
    expect(factRows(item({ citedBy: null, pdfOnPage: false, access: null }), null)).toEqual([]);
    expect(
      factRows(item({ citedBy: 1234, pdfOnPage: true, access: null }), { ...PREVIEW, citedBy: 9 }),
    ).toEqual([
      ['Cited by', '1,234 on Google Scholar'],
      ['PDF', 'Found on this page'],
    ]);
    expect(
      factRows(item({ citedBy: null, pdfOnPage: false, access: null }), {
        ...PREVIEW,
        kind: 'arxiv',
        citedBy: null,
        openAccessVia: 'arXiv',
      }),
    ).toEqual([['Access', 'Open access on arXiv']]);
    expect(
      factRows(item({ citedBy: null, pdfOnPage: false, access: null }), { ...PREVIEW, citedBy: 0 }),
    ).toEqual([['Cited by', '0 (Crossref)']]);
  });
});
