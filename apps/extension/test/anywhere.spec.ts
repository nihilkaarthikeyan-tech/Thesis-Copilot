// @vitest-environment jsdom
/**
 * ADR-0154, add-on 0.3.2: Save buttons on every site (opt-in), several results saved at once from
 * the in-page card. Against hand-written structural fixtures and small hand-written pages; every
 * paper, journal and DOI is invented (Crossref's test prefix 10.5555). Nothing requests a site.
 *
 * Pinned:
 * - the switch's access is an optional permission, and the buttons' script is registered only
 *   while it is held, never on the five sites (they have it already), our own site or Jenni's;
 * - a content script on another site is answered only while the student has it on;
 * - on any other site a paper is found by its tags (`citation_doi`, `dc.identifier`, `prism.doi`,
 *   Highwire's `citation_title`) and by the DOI links of a reference list — one small button per
 *   reference, none beside a DOI in the body text, a hidden reference or the page's own DOI;
 * - "Select several" saves the ticked ones in one request and one resolve call, and says what
 *   became of each: saved, already in the library, not saved and why.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ANYWHERE_ORIGINS,
  ANYWHERE_SCRIPT_ID,
  type AnywhereChrome,
  anywhereExcludes,
  anywhereScript,
  neverHere,
  ownHosts,
  syncAnywhere,
} from '../src/anywhere.js';
import {
  bulkDone,
  bulkSaving,
  bulkStart,
  bulkSummary,
  outcomeText,
  selectAll,
  toggleRow,
} from '../src/bulk.js';
import { INPAGE_MATCHES, senderMay } from '../src/hosts.js';
import { type CardDeps, findSpots, shadowOf, startInpage } from '../src/inpage.js';
import { BULK_MAX } from '../src/lists.js';
import { SAVED_KEY } from '../src/memory.js';
import {
  INPAGE_REQUESTS,
  type Reply,
  type Request,
  type SaveManyJob,
  type SaveResult,
} from '../src/messages.js';
import type { Paper } from '../src/paper.js';
import { checkSaveManyJob, saveMany } from '../src/save.js';

const WEB = 'https://thesis.rademics.ai';
const OWN = ['thesis.rademics.ai'];
const DOC = '0190a3c4-0000-7000-8000-000000000001';
const id = (n: number) => `0190a3c4-0000-7000-8000-${String(n).padStart(12, '0')}`;

function load(name: string): void {
  const html = readFileSync(join(process.cwd(), 'test', 'fixtures', name), 'utf8');
  document.documentElement.innerHTML = new DOMParser().parseFromString(
    html,
    'text/html',
  ).documentElement.innerHTML;
}

function page(head: string, body: string): void {
  document.documentElement.innerHTML = `<head>${head}</head><body>${body}</body>`;
}

const settle = async (rounds = 8) => {
  for (let i = 0; i < rounds; i += 1) await new Promise((done) => setTimeout(done, 0));
};

afterEach(() => {
  document.documentElement.innerHTML = '<head></head><body></body>';
});

// ---- The switch's access and the script it registers ---------------------------------------------

describe('the every-site switch', () => {
  it('asks for every https site, and registers the buttons’ script for it, top frame only', () => {
    expect(ANYWHERE_ORIGINS).toEqual(['https://*/*']);
    const script = anywhereScript(OWN);
    expect(script).toMatchObject({
      id: ANYWHERE_SCRIPT_ID,
      matches: ['https://*/*'],
      js: ['content.js'],
      runAt: 'document_idle',
      allFrames: false,
    });
  });

  it('never on the five sites (they have the script), our own site or Jenni’s', () => {
    const excludes = anywhereExcludes(OWN);
    for (const pattern of INPAGE_MATCHES) expect(excludes).toContain(pattern);
    expect(excludes).toContain('https://thesis.rademics.ai/*');
    expect(excludes).toContain('https://jenni.ai/*');
    expect(excludes).toContain('https://*.jenni.ai/*');
    expect(neverHere('app.jenni.ai', OWN)).toBe(true);
    expect(neverHere('jenni.ai', OWN)).toBe(true);
    expect(neverHere('thesis.rademics.ai', OWN)).toBe(true);
    expect(neverHere('notjenni.ai', OWN)).toBe(false);
    expect(neverHere('en.wikipedia.org', OWN)).toBe(false);
    expect(ownHosts(['https://thesis.rademics.ai', 'not a url'])).toEqual(OWN);
  });

  function chromeFake(granted: boolean, present: boolean) {
    const calls: string[] = [];
    const api: AnywhereChrome = {
      contains: async (p) => {
        calls.push(`contains ${p.origins?.join(',')}`);
        return granted;
      },
      registered: async () => (present ? [{ id: ANYWHERE_SCRIPT_ID }] : []),
      register: async (scripts) => {
        calls.push(`register ${scripts.map((s) => s.id).join(',')}`);
      },
      unregister: async (ids) => {
        calls.push(`unregister ${ids.join(',')}`);
      },
    };
    return { api, calls };
  }

  it('registers the script once the access is granted, and only then', async () => {
    const on = chromeFake(true, false);
    expect(await syncAnywhere(on.api, OWN)).toBe(true);
    expect(on.calls).toEqual(['contains https://*/*', `register ${ANYWHERE_SCRIPT_ID}`]);

    const again = chromeFake(true, true);
    await syncAnywhere(again.api, OWN);
    expect(again.calls.filter((c) => c.startsWith('register'))).toEqual([]);

    const never = chromeFake(false, false);
    expect(await syncAnywhere(never.api, OWN)).toBe(false);
    expect(never.calls.filter((c) => !c.startsWith('contains'))).toEqual([]);
  });

  it('unregisters it when the access is taken away (the switch, or chrome://extensions)', async () => {
    const off = chromeFake(false, true);
    expect(await syncAnywhere(off.api, OWN)).toBe(false);
    expect(off.calls).toContain(`unregister ${ANYWHERE_SCRIPT_ID}`);
  });
});

describe('who the service worker answers, with the switch on', () => {
  const ownOrigin = 'chrome-extension://abc/';
  const anywhere = { never: (host: string) => neverHere(host, OWN) };
  const wiki = { tab: {}, url: 'https://en.wikipedia.org/wiki/Rooftop_solar' };

  it('a content script on any https site, the card’s requests only', () => {
    expect(senderMay(wiki, 'save-many', ownOrigin, INPAGE_REQUESTS, anywhere)).toBe(true);
    expect(senderMay(wiki, 'lookup', ownOrigin, INPAGE_REQUESTS, anywhere)).toBe(true);
    expect(senderMay(wiki, 'save', ownOrigin, INPAGE_REQUESTS, anywhere)).toBe(false);
    expect(senderMay(wiki, 'anywhere-sync', ownOrigin, INPAGE_REQUESTS, anywhere)).toBe(false);
  });

  it('not with the switch off, not over http, not from our site or Jenni’s', () => {
    expect(senderMay(wiki, 'lookup', ownOrigin, INPAGE_REQUESTS)).toBe(false);
    const from = (url: string) =>
      senderMay({ tab: {}, url }, 'lookup', ownOrigin, INPAGE_REQUESTS, anywhere);
    expect(from('http://en.wikipedia.org/wiki/X')).toBe(false);
    expect(from('https://thesis.rademics.ai/app')).toBe(false);
    expect(from('https://app.jenni.ai/library')).toBe(false);
  });
});

// ---- Finding papers on any other site ------------------------------------------------------------

describe('a reference list (Wikipedia’s structure)', () => {
  const URL_ = 'https://en.wikipedia.org/wiki/Rooftop_solar_in_villages';

  it('one small Save button beside each referenced DOI, one per reference', () => {
    load('wikipedia-references.html');
    const spots = findSpots(URL_, OWN);
    expect(spots.map((s) => s.item.paper.doi)).toEqual([
      '10.5555/sjea.2021.0045',
      '10.5555/sgs.2019.0004',
      '10.5555/spr.2020.0088',
    ]);
    for (const spot of spots) {
      expect(spot.compact).toBe(true);
      expect(spot.where).toBe('after');
      expect(spot.item.origin).toBe('reference');
      // Beside the DOI link that shows the DOI, not the "Archived copy" link after it.
      expect(spot.anchor.textContent).toBe(spot.item.paper.doi);
    }
    expect(spots[0]?.item.refs).toEqual([{ kind: 'doi', id: '10.5555/sjea.2021.0045' }]);
    expect(spots[0]?.item.paper.title).toBe('Credit and rooftop solar uptake in rural districts');
    expect(spots[0]?.item.paper.year).toBe('2021');
    // The reference line as the page shows it goes with the DOI, for the library's matcher.
    expect(spots[0]?.item.paper.reference).toContain('Sample Journal of Energy Access');
  });

  it('none beside a DOI in the body text, a hidden reference, or a book with no DOI', () => {
    load('wikipedia-references.html');
    const dois = findSpots(URL_, OWN).map((s) => s.item.paper.doi);
    expect(dois).not.toContain('10.5555/body.2024.0001');
    expect(dois).not.toContain('10.5555/hidden.2017.0001');
    expect(dois).toHaveLength(3);
  });

  it('the button sits inline after the link and says "Save"; the full words for a reader', async () => {
    load('wikipedia-references.html');
    const run = startInpage(fake().deps, () => URL_);
    const hosts = Array.from(document.querySelectorAll('[data-tc-addon="button"]'));
    expect(hosts).toHaveLength(3);
    const first = hosts[0] as HTMLElement;
    expect(first.previousElementSibling?.textContent).toBe('10.5555/sjea.2021.0045');
    expect(first.style.getPropertyValue('display')).toBe('inline-block');
    const button = shadowOf(first)?.querySelector('button');
    expect(button?.textContent).toBe('Save');
    expect(button?.getAttribute('aria-label')).toBe(
      'Add to Thesis Copilot: Credit and rooftop solar uptake in rural districts',
    );
    run.stop();
  });

  it('nothing at all on our own site or on Jenni’s, whatever the page holds', () => {
    load('wikipedia-references.html');
    expect(findSpots('https://thesis.rademics.ai/app/d/x/sources', OWN)).toEqual([]);
    expect(findSpots('https://app.jenni.ai/library', OWN)).toEqual([]);
  });
});

describe('an article page on another site, by its tags', () => {
  const ARTICLE = 'https://journal.example.org/article/42';

  it('citation_doi: a button beside its DOI link; its own DOI in the references gets none', () => {
    page(
      '<meta name="citation_title" content="Sample paper on village grids"><meta name="citation_doi" content="10.5555/own.2022.0001"><meta name="citation_author" content="Rao, Asha">',
      `<h1>Sample paper on village grids</h1>
       <p>DOI: <a href="https://doi.org/10.5555/own.2022.0001">10.5555/own.2022.0001</a></p>
       <ol class="references">
         <li>Earlier work. <a href="https://doi.org/10.5555/own.2022.0001">10.5555/own.2022.0001</a></li>
         <li>Iyer, B. (2020). "A cited sample study". <a href="https://doi.org/10.5555/cited.2020.0002">10.5555/cited.2020.0002</a></li>
       </ol>`,
    );
    const spots = findSpots(ARTICLE, OWN);
    expect(spots.map((s) => [s.item.origin, s.item.paper.doi])).toEqual([
      ['article', '10.5555/own.2022.0001'],
      ['reference', '10.5555/cited.2020.0002'],
    ]);
    expect(spots[0]?.compact).toBeFalsy();
    expect(spots[0]?.anchor.closest('p')).not.toBeNull();
  });

  it('dc.identifier and prism.doi name the article too', () => {
    for (const tag of ['dc.identifier', 'prism.doi']) {
      page(
        `<meta name="${tag}" content="doi:10.5555/tagged.2023.0007"><meta name="dc.title" content="A tagged sample">`,
        '<h1>A tagged sample</h1><a href="https://doi.org/10.5555/tagged.2023.0007">https://doi.org/10.5555/tagged.2023.0007</a>',
      );
      const spots = findSpots(ARTICLE, OWN);
      expect(spots).toHaveLength(1);
      expect(spots[0]?.item.refs).toEqual([{ kind: 'doi', id: '10.5555/tagged.2023.0007' }]);
    }
  });

  it('Highwire tags with no DOI: a button under the title, saved by its details', () => {
    page(
      '<meta name="citation_title" content="A conference paper with no DOI"><meta name="citation_author" content="Das, Chitra"><meta name="citation_publication_date" content="2024/02/01">',
      '<h1>A conference paper with no DOI</h1><p>Text.</p>',
    );
    const spots = findSpots(ARTICLE, OWN);
    expect(spots).toHaveLength(1);
    expect(spots[0]?.anchor.tagName).toBe('H1');
    expect(spots[0]?.item.refs).toEqual([]);
    expect(spots[0]?.item.paper).toMatchObject({
      title: 'A conference paper with no DOI',
      doi: null,
      year: '2024',
    });
  });

  it('a citation_title alone (no author, date or journal) is not enough', () => {
    page(
      '<meta name="citation_title" content="Just a page title here">',
      '<h1>Just a page title here</h1>',
    );
    expect(findSpots(ARTICLE, OWN)).toEqual([]);
  });

  it('a page that is no paper and has no reference list gets nothing', () => {
    page(
      '<title>News</title>',
      '<h1>News</h1><a href="https://doi.org/10.5555/x.1">10.5555/x.1</a>',
    );
    expect(findSpots('https://news.example.org/story', OWN)).toEqual([]);
  });
});

// ---- Select several: the pure part -----------------------------------------------------------------

describe('select several, as a state', () => {
  it('opens with the pressed row ticked — unless it was saved already', () => {
    expect(bulkStart(2, new Set()).selected).toEqual([2]);
    expect(bulkStart(2, new Set([2])).selected).toEqual([]);
    expect(bulkStart(null, new Set()).selected).toEqual([]);
  });

  it('ticks and unticks, keeps list order, never more than BULK_MAX', () => {
    let state = bulkStart(3, new Set());
    state = toggleRow(state, 1, true);
    expect(state.selected).toEqual([1, 3]);
    state = toggleRow(state, 3, false);
    expect(state.selected).toEqual([1]);
    const full = selectAll(state, BULK_MAX + 10, new Set());
    expect(full.selected).toHaveLength(BULK_MAX);
    expect(toggleRow(full, BULK_MAX + 5, true).selected).toHaveLength(BULK_MAX);
  });

  it('select all skips the ones already saved', () => {
    expect(selectAll(bulkStart(null, new Set()), 4, new Set([1])).selected).toEqual([0, 2, 3]);
  });

  it('maps each answer back to its row; the failed stay ticked, with their reason', () => {
    let state = bulkSaving(toggleRow(toggleRow(bulkStart(0, new Set()), 2, true), 3, true));
    const reply: Reply<SaveResult> = {
      ok: true,
      value: {
        results: [
          { key: 'r0', status: 'saved', sourceId: id(1) },
          { key: 'r1', status: 'present', sourceId: id(2) },
          { key: 'r2', status: 'failed', sourceId: null, message: 'Thesis Copilot answered 429.' },
        ],
        pdf: null,
        collection: null,
        signedOut: false,
      },
    };
    state = bulkDone(state, [0, 2, 3], reply);
    expect(state.phase).toBe('done');
    expect(outcomeText(state.outcomes[0])).toBe('Saved');
    expect(outcomeText(state.outcomes[2])).toBe('Already in your library');
    expect(outcomeText(state.outcomes[3])).toBe('Not saved: Thesis Copilot answered 429.');
    expect(state.selected).toEqual([3]);
    expect(bulkSummary(state, [0, 2, 3])).toBe('1 saved · 1 already in your library · 1 not saved');
    // After a save, "select all" leaves out the saved and the ones already there.
    expect(selectAll(state, 4, new Set()).selected).toEqual([1, 3]);
  });

  it('a row with no answer is said as failed; a whole failure keeps every row ticked', () => {
    const saving = bulkSaving(toggleRow(bulkStart(0, new Set()), 1, true));
    const partial = bulkDone(saving, [0, 1], {
      ok: true,
      value: {
        results: [{ key: 'r0', status: 'saved', sourceId: id(1) }],
        pdf: null,
        collection: null,
        signedOut: false,
      },
    });
    expect(partial.outcomes[1]?.status).toBe('failed');
    const whole = bulkDone(saving, [0, 1], { ok: false, status: 0, message: 'Offline.' });
    expect(whole.error).toBe('Offline.');
    expect(whole.selected).toEqual([0, 1]);
    expect(bulkDone(saving, [0, 1], { ok: false, status: 401, message: 'x' }).signedOut).toBe(true);
  });
});

// ---- Select several: what the service worker does --------------------------------------------------

const P = (n: number, doi: string | null = `10.5555/p${n}`): Paper => ({
  title: `Sample paper ${n}`,
  doi,
  reference: `Author (2020). Sample paper ${n}.`,
});

describe('save-many in the service worker', () => {
  it('accepts only ids, 1 to BULK_MAX papers, each checked', () => {
    const ok: SaveManyJob = { documentId: DOC, collectionId: null, papers: [P(1), P(2, null)] };
    expect(checkSaveManyJob(ok)).toMatchObject(ok);
    expect(checkSaveManyJob({ ...ok, documentId: 'x' })).toBeNull();
    expect(checkSaveManyJob({ ...ok, collectionId: 'x' })).toBeNull();
    expect(checkSaveManyJob({ ...ok, papers: [] })).toBeNull();
    expect(
      checkSaveManyJob({ ...ok, papers: Array.from({ length: BULK_MAX + 1 }, (_, i) => P(i)) }),
    ).toBeNull();
    expect(checkSaveManyJob({ ...ok, papers: [P(1), { ...P(2), doi: 'not a doi' }] })).toBeNull();
  });

  it('sends every new reference in one resolve call; the library’s DOIs are already there', async () => {
    const calls: Array<Array<{ raw: string; doi?: string }>> = [];
    const result = await saveMany(
      {
        documentId: DOC,
        collectionId: null,
        papers: Array.from({ length: 14 }, (_, i) => P(i)),
      },
      {
        api: {
          library: async () => ({
            ok: true,
            value: [{ id: id(500), doi: '10.5555/p3', hasFile: false }],
          }),
          resolve: async (_doc, refs) => {
            calls.push(refs);
            // The 6th sent is not taken.
            return {
              ok: true,
              value: { sourceIds: refs.map((_, i) => (i === 5 ? null : id(i + 1))) },
            };
          },
          addToCollection: async () => ({ ok: true, value: {} }),
          uploadPdf: async () => ({ ok: false, status: 0, message: 'no' }),
          attachPdf: async () => ({ ok: false, status: 0, message: 'no' }),
        },
      },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(13);
    expect(result.results.map((r) => r.key)).toEqual(Array.from({ length: 14 }, (_, i) => `r${i}`));
    expect(result.results[3]).toMatchObject({ status: 'present', sourceId: id(500) });
    const failed = result.results.filter((r) => r.status === 'failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]?.message).toBe('Thesis Copilot did not take this one.');
  });
});

// ---- Select several: in the card ----------------------------------------------------------------

type Answers = Partial<Record<Request['type'], (request: Request) => Reply<unknown>>>;

function fake(answers: Answers = {}) {
  const asked: Request[] = [];
  const stored: Record<string, unknown> = {};
  const deps: CardDeps = {
    ask: async <T>(request: Request) => {
      asked.push(request);
      const answer = answers[request.type];
      return (
        answer ? answer(request) : { ok: false, status: 500, message: 'Not answered in this test.' }
      ) as Reply<T>;
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
  theses: () => ({ ok: true, value: [{ id: DOC, title: 'Solar in villages' }] }),
  collections: () => ({ ok: true, value: [] }),
  lookup: () => ({ ok: false, status: 404, message: 'No record.' }),
};

function cardRoot(host: HTMLElement | null): ShadowRoot {
  const root = host ? shadowOf(host) : null;
  if (!root) throw new Error('the card is not open');
  return root;
}

const byTest = (root: ShadowRoot, testId: string) =>
  root.querySelector<HTMLElement>(`[data-testid="${testId}"]`);

describe('select several in the card', () => {
  it('lists every reference, saves the ticked in one request, and says what became of each', async () => {
    load('wikipedia-references.html');
    const { deps, asked, stored } = fake({
      ...signedIn,
      'save-many': () => ({
        ok: true,
        value: {
          results: [
            { key: 'r0', status: 'saved', sourceId: id(1) },
            {
              key: 'r1',
              status: 'failed',
              sourceId: null,
              message: 'Your plan allows 10 more papers this month.',
            },
          ],
          pdf: null,
          collection: null,
          signedOut: false,
        },
      }),
    });
    const run = startInpage(deps, () => 'https://en.wikipedia.org/wiki/Rooftop_solar_in_villages');
    const hosts = Array.from(document.querySelectorAll<HTMLElement>('[data-tc-addon="button"]'));
    shadowOf(hosts[0] as HTMLElement)
      ?.querySelector('button')
      ?.click();
    await settle();
    let root = cardRoot(run.card.host);
    const several = byTest(root, 'tc-several');
    expect(several?.textContent).toBe('Select several (3)');
    several?.click();
    root = cardRoot(run.card.host);
    const rows = () => Array.from(root.querySelectorAll<HTMLElement>('[data-testid="tc-row"]'));
    expect(rows()).toHaveLength(3);
    const boxes = () => rows().map((row) => row.querySelector('input') as HTMLInputElement);
    // The pressed reference is ticked already.
    expect(boxes().map((b) => b.checked)).toEqual([true, false, false]);
    const third = boxes()[2] as HTMLInputElement;
    third.checked = true;
    third.dispatchEvent(new Event('change'));
    expect(byTest(root, 'tc-bulk-save')?.textContent).toBe('Save selected (2)');
    byTest(root, 'tc-bulk-save')?.click();
    await settle();

    const sent = asked.filter((r) => r.type === 'save-many');
    expect(sent).toHaveLength(1);
    const job = (sent[0] as Extract<Request, { type: 'save-many' }>).job;
    expect(job.documentId).toBe(DOC);
    expect(job.papers.map((p) => p.doi)).toEqual([
      '10.5555/sjea.2021.0045',
      '10.5555/spr.2020.0088',
    ]);

    const outcomes = Array.from(root.querySelectorAll('[data-testid="tc-row-outcome"]')).map(
      (n) => n.textContent,
    );
    expect(outcomes).toEqual(['Saved', 'Not saved: Your plan allows 10 more papers this month.']);
    expect(byTest(root, 'tc-message')?.textContent).toContain('1 saved · 1 not saved');
    // The failed one stays ticked, for another try.
    expect(boxes().map((b) => b.checked)).toEqual([false, false, true]);
    expect(byTest(root, 'tc-bulk-save')?.textContent).toBe('Try again (1)');
    // The saved one's button says so, and this browser remembers it for the thesis.
    const label = shadowOf(hosts[0] as HTMLElement)?.querySelector('button')?.textContent;
    expect(label).toBe('Saved');
    expect(JSON.stringify(stored[SAVED_KEY])).toContain('doi:10.5555/sjea.2021.0045');
    run.stop();
  });

  it('on a results page too (PubMed search): every result, and Back returns to the one', async () => {
    load('pubmed-results.html');
    const { deps } = fake(signedIn);
    const run = startInpage(deps, () => 'https://pubmed.ncbi.nlm.nih.gov/?term=x');
    const hosts = Array.from(document.querySelectorAll<HTMLElement>('[data-tc-addon="button"]'));
    expect(hosts.length).toBeGreaterThanOrEqual(2);
    shadowOf(hosts[1] as HTMLElement)
      ?.querySelector('button')
      ?.click();
    await settle();
    const root = cardRoot(run.card.host);
    byTest(root, 'tc-several')?.click();
    const rows = Array.from(root.querySelectorAll('[data-testid="tc-row"]'));
    expect(rows).toHaveLength(hosts.length);
    expect(rows[1]?.querySelector<HTMLInputElement>('input')?.checked).toBe(true);
    byTest(root, 'tc-back')?.click();
    expect(byTest(root, 'tc-save')).not.toBeNull();
    run.stop();
  });

  it('an article page’s own card offers no "Select several"', async () => {
    load('wikipedia-references.html');
    // The same page, given the article's own tags: one article button plus the references.
    document.head.insertAdjacentHTML(
      'beforeend',
      '<meta name="citation_doi" content="10.5555/sjea.2021.0045"><meta name="citation_title" content="Credit and rooftop solar uptake in rural districts">',
    );
    const { deps } = fake(signedIn);
    const run = startInpage(deps, () => 'https://journal.example.org/a/1');
    const article = document.querySelector<HTMLElement>('[data-tc-addon="button"]');
    shadowOf(article as HTMLElement)
      ?.querySelector('button')
      ?.click();
    await settle();
    expect(byTest(cardRoot(run.card.host), 'tc-several')).toBeNull();
    run.stop();
  });
});
