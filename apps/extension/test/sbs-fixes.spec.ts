// @vitest-environment jsdom
/**
 * What the side-by-side with Jenni's add-on found on live pages on 2026-10-10
 * (docs/research/EXTENSION-SIDE-BY-SIDE-2026-10-10.md, kept local), pinned against hand-written
 * structural fixtures and a fake service worker. Nothing here requests a live site.
 *
 * - A Google Scholar result linking Emerald's `…/article/doi/10.1108/IJESM-05-2025-0048/1343209`
 *   was read as the DOI `10.1108/IJESM-05-2025-0048/1343209`: the card said "No record found",
 *   and a second save said "Saved" for a paper already in the library. The shorter DOI is now
 *   tried next, and a library row under it is "already there".
 * - On a PubMed article the button went beside the publisher's full-text logo in the side column
 *   (the first link to the DOI in the page), not beside the DOI in the identifiers line.
 * - PubMed's "Free PMC article"/PMCID and a Creative Commons licence in an article's tags are
 *   now said in the card; a paper free on arXiv or in PubMed Central no longer tells the student
 *   to go and attach its PDF, which the library fetches itself.
 * - MDPI search results had no buttons (Jenni's had); now each result has one, by its own DOI.
 * - A page visited again showed "Add to Thesis Copilot" for papers already saved from it; Jenni's
 *   showed "View in Jenni". Buttons now remember what this browser saved, per thesis.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type CardDeps,
  createCard,
  findSpots,
  type InpageItem,
  pdfLine,
  shadowOf,
  startInpage,
} from '../src/inpage.js';
import { itemFrom } from '../src/lists.js';
import { PER_THESIS, paperKeys, remember, SAVED_KEY, THESES, wasSaved } from '../src/memory.js';
import type { Preview, Reply, Request, SaveJob, SaveOneJob } from '../src/messages.js';
import { collectResultList } from '../src/page.js';
import { doiCandidates, openLicence } from '../src/paper.js';
import { doiRefs, refsOfItem } from '../src/refs.js';
import { runSave, type SaveDeps } from '../src/save.js';

const DOC = '0190a3c4-0000-7000-8000-000000000001';
const SOURCE = '0190a3c4-0000-7000-8000-000000000101';
const EMERALD = 'https://www.emerald.com/ijesm/article/doi/10.1108/IJESM-05-2025-0048/1343209';

function load(name: string): void {
  const html = readFileSync(join(process.cwd(), 'test', 'fixtures', name), 'utf8');
  document.documentElement.innerHTML = new DOMParser().parseFromString(
    html,
    'text/html',
  ).documentElement.innerHTML;
}

const settle = async (rounds = 8) => {
  for (let i = 0; i < rounds; i += 1) await new Promise((done) => setTimeout(done, 0));
};

type Answers = Partial<Record<Request['type'], (request: Request) => Reply<unknown>>>;

function fake(answers: Answers = {}, stored: Record<string, unknown> = {}) {
  const asked: Request[] = [];
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
    webUrl: 'https://thesis.rademics.ai',
    mode: 'closed',
  };
  return { deps, asked, stored };
}

const signedIn: Answers = {
  theses: () => ({ ok: true, value: [{ id: DOC, title: 'Rooftop solar in rural India' }] }),
  collections: () => ({ ok: true, value: [] }),
};

const PREVIEW: Preview = {
  kind: 'doi',
  title: 'Understanding solar power adoption in emerging markets',
  byline: 'A Pandey, S Dhaigude, K Baishya',
  year: 2026,
  venue: 'International Journal of Energy Sector Management',
  doi: '10.1108/ijesm-05-2025-0048',
  citedBy: 0,
  openAccessVia: null,
};

const root = (host: HTMLElement | null): ShadowRoot => {
  const r = host ? shadowOf(host) : null;
  if (!r) throw new Error('the card is not open');
  return r;
};
const q = (r: ShadowRoot, testId: string) =>
  r.querySelector<HTMLElement>(`[data-testid="${testId}"]`);

afterEach(() => {
  document.documentElement.innerHTML = '<head></head><body></body>';
});

// ---- A DOI read from an address ---------------------------------------------------------------

describe('a DOI read from a publisher’s address', () => {
  it('is tried as read, then without the article id or view name the publisher put after it', () => {
    expect(doiCandidates('10.1108/IJESM-05-2025-0048/1343209')).toEqual([
      '10.1108/IJESM-05-2025-0048/1343209',
      '10.1108/IJESM-05-2025-0048',
    ]);
    expect(doiCandidates('10.1080/10630732.2023.2172305/full')).toEqual([
      '10.1080/10630732.2023.2172305/full',
      '10.1080/10630732.2023.2172305',
    ]);
    // A DOI that ends in a word part of the DOI itself is left alone; the prefix is never cut.
    expect(doiCandidates('10.1002/sd.2644')).toEqual(['10.1002/sd.2644']);
    expect(doiCandidates('10.1000/abc/chapter')).toEqual(['10.1000/abc/chapter']);
    expect(doiCandidates('10.1000/123')).toEqual(['10.1000/123']);
  });

  it('gives the Scholar result both refs, the DOI as read first', () => {
    const item = itemFrom('scholar', {
      title: 'Understanding solar power adoption in emerging markets',
      byline:
        'AK Pandey, SA Dhaigude, K Baishya - International Journal of Energy …, 2026 - emerald.com',
      citation: '',
      pmid: '',
      arxivId: '',
      href: EMERALD,
    });
    expect(item?.doi).toBe('10.1108/IJESM-05-2025-0048/1343209');
    expect(refsOfItem(item as NonNullable<typeof item>)).toEqual([
      { kind: 'doi', id: '10.1108/IJESM-05-2025-0048/1343209' },
      { kind: 'doi', id: '10.1108/IJESM-05-2025-0048' },
    ]);
    expect(doiRefs(null)).toEqual([]);
  });

  it('the card looks the shorter DOI up when the first has no record, and saves by it', async () => {
    document.body.innerHTML = `
      <div class="gs_r gs_or gs_scl" data-cid="EMER1"><div class="gs_ri">
        <h3 class="gs_rt"><a href="${EMERALD}">Understanding solar power adoption in emerging markets</a></h3>
        <div class="gs_a">AK Pandey, SA Dhaigude, K Baishya - International Journal of Energy …, 2026 - emerald.com</div>
        <div class="gs_fl gs_flb"><a href="/scholar?cites=1">Cited by 1</a></div>
      </div></div>`;
    const [spot] = findSpots(
      'https://scholar.google.com/scholar?q=rooftop+solar+adoption+rural+India',
    );
    if (!spot) throw new Error('no spot');
    const { deps, asked } = fake({
      ...signedIn,
      lookup: (request) =>
        (request as { ref: { id: string } }).ref.id.endsWith('/1343209')
          ? { ok: false, status: 404, message: 'No paper with that DOI' }
          : { ok: true, value: PREVIEW },
      'save-one': () => ({
        ok: true,
        value: {
          key: 'one',
          status: 'present',
          sourceId: SOURCE,
          collection: null,
          signedOut: false,
          via: 'id',
        },
      }),
    });
    const card = createCard(deps);
    card.open(spot.item, null);
    await settle();
    const r = root(card.host);
    expect(r.querySelector('[data-testid="tc-paper"] .id')?.textContent).toBe(
      'DOI 10.1108/IJESM-05-2025-0048',
    );
    expect(q(r, 'tc-paper')?.textContent).toContain('✓ Details found in Crossref');
    expect(q(r, 'tc-paper')?.textContent).not.toContain('No record found');
    q(r, 'tc-save')?.click();
    await settle();
    const job = (asked.find((x) => x.type === 'save-one') as { job: SaveOneJob }).job;
    expect(job.ref).toEqual({ kind: 'doi', id: '10.1108/IJESM-05-2025-0048' });
    expect(q(r, 'tc-message')?.textContent).toContain('Already in the library');
  });

  it('a bulk save finds the library row under the shorter DOI: already there, not sent', async () => {
    const resolved: unknown[] = [];
    const deps: SaveDeps = {
      api: {
        library: async () => ({
          ok: true,
          value: [{ id: SOURCE, doi: '10.1108/ijesm-05-2025-0048', hasFile: false }],
        }),
        resolve: async (_d, refs) => {
          resolved.push(refs);
          return { ok: true, value: { sourceIds: refs.map(() => SOURCE) } };
        },
        addToCollection: async () => ({ ok: true, value: {} }),
        uploadPdf: async () => ({ ok: true, value: { id: SOURCE } }),
        attachPdf: async () => ({ ok: true, value: { id: SOURCE } }),
      },
      fetchPdf: async () => ({ ok: false, message: 'none' }),
    };
    const job: SaveJob = {
      runId: 'r',
      documentId: DOC,
      collectionId: null,
      items: [
        {
          key: 'a',
          paper: {
            title: 'Understanding solar power adoption',
            doi: '10.1108/IJESM-05-2025-0048/1343209',
            reference: 'Pandey (2026). Understanding solar power adoption.',
          },
        },
      ],
      pdf: null,
    };
    const result = await runSave(job, deps);
    expect(result.results).toEqual([{ key: 'a', status: 'present', sourceId: SOURCE }]);
    expect(resolved).toEqual([]);
  });
});

// ---- PubMed: where the button goes, what the card says ---------------------------------------

describe('a PubMed article whose full-text link to the DOI comes first in the page', () => {
  it('gets its button beside the DOI shown in the identifiers line, not the side column', () => {
    load('pubmed-article-fulltext.html');
    const spots = findSpots('https://pubmed.ncbi.nlm.nih.gov/41000001/');
    expect(spots).toHaveLength(1);
    const anchor = spots[0]?.anchor as Element;
    expect(anchor.closest('#full-view-identifiers')).not.toBeNull();
    expect(anchor.closest('.full-text-links')).toBeNull();
    expect(anchor.textContent).toBe('10.5555/sr.2025.2197');
  });

  it('says it is free in PubMed Central, from the page’s PMCID link', () => {
    load('pubmed-article-fulltext.html');
    const [spot] = findSpots('https://pubmed.ncbi.nlm.nih.gov/41000001/');
    expect(spot?.item.facts).toEqual({
      citedBy: null,
      pdfOnPage: false,
      access: 'Free in PubMed Central',
    });
  });

  it('a result marked "Free PMC article." says so too', () => {
    load('pubmed-results.html');
    const article = document.querySelector('article.full-docsum');
    const citation = article?.querySelector('.docsum-citation') ?? article;
    citation?.insertAdjacentHTML(
      'beforeend',
      '<span class="free-resources spaced-citation-item citation-part">Free PMC article.</span>',
    );
    const spots = findSpots('https://pubmed.ncbi.nlm.nih.gov/?term=heat');
    expect(spots[0]?.item.facts.access).toBe('Free in PubMed Central');
    expect(spots[1]?.item.facts.access ?? null).toBeNull();
  });
});

describe('what the saved card says about the PDF', () => {
  const item = (facts: Partial<InpageItem['facts']>): InpageItem => ({
    origin: 'article',
    paper: { title: 'T', doi: '10.5555/x', reference: 'T' },
    refs: [{ kind: 'doi', id: '10.5555/x' }],
    facts: { citedBy: null, pdfOnPage: false, access: null, ...facts },
  });

  it('a paper free on arXiv or in PubMed Central: its full text is fetched, nothing to do', () => {
    expect(pdfLine(item({ pdfOnPage: true }), { ...PREVIEW, openAccessVia: 'arXiv' })).toBe(
      'Its free full text is fetched from arXiv.',
    );
    expect(pdfLine(item({ access: 'Free in PubMed Central' }), null)).toBe(
      'Its free full text is fetched from PubMed Central.',
    );
  });

  it('any other PDF on the page: how to attach it, in the two ways that work', () => {
    expect(pdfLine(item({ pdfOnPage: true }), PREVIEW)).toContain('toolbar button');
    expect(pdfLine(item({ pdfOnPage: true }), PREVIEW)).toContain('“Add a PDF” in the library');
    expect(pdfLine(item({}), PREVIEW)).toBeNull();
  });
});

describe('a licence in the article’s own tags', () => {
  const page = (meta: Array<[string, string]>) => ({
    url: 'https://www.mdpi.com/x',
    title: '',
    meta,
  });

  it('is said as open access with the licence, only when it is Creative Commons', () => {
    expect(openLicence(page([['dc.rights', 'http://creativecommons.org/licenses/by/3.0/']]))).toBe(
      'Open access (CC BY 3.0)',
    );
    expect(
      openLicence(
        page([['dcterms.license', 'https://creativecommons.org/licenses/by-nc-nd/4.0/']]),
      ),
    ).toBe('Open access (CC BY-NC-ND 4.0)');
    expect(
      openLicence(page([['dc.rights', '© 2025 Elsevier Ltd. All rights reserved.']])),
    ).toBeNull();
    expect(openLicence(page([]))).toBeNull();
  });
});

// ---- MDPI search results -----------------------------------------------------------------------

describe('MDPI search results', () => {
  it('each result gets one button, after its own DOI link, saving that article by its DOI', () => {
    load('mdpi-search.html');
    const spots = findSpots('https://www.mdpi.com/search?q=rooftop+solar+India');
    expect(spots).toHaveLength(3);
    expect(spots.map((s) => s.item.refs)).toEqual([
      [{ kind: 'doi', id: '10.5555/en18081921' }],
      [{ kind: 'doi', id: '10.5555/rs17071221' }],
      [],
    ]);
    expect(spots[0]?.where).toBe('after');
    expect((spots[0]?.anchor as HTMLAnchorElement | undefined)?.href).toBe(
      'https://doi.org/10.5555/en18081921',
    );
    expect(spots[0]?.item.paper).toMatchObject({
      title: 'Performance of a Rooftop Photovoltaic System in Manipur',
      byline: 'Asha Singh, Bina Shimray, Chitra Meitei',
      year: '2025',
      venue: 'Sample Energies',
      doi: '10.5555/en18081921',
    });
    expect(spots[0]?.item.facts).toEqual({
      citedBy: null,
      pdfOnPage: true,
      access: 'Open access (MDPI)',
    });
    expect(spots[1]?.item.facts.access).toBeNull();
    expect(spots[0]?.item.origin).toBe('mdpi');
  });

  it('only on the search page: an issue’s contents keep no buttons (ADR-0125)', () => {
    load('mdpi-search.html');
    expect(collectResultList('www.mdpi.com', false, '/search')?.items).toHaveLength(3);
    expect(collectResultList('www.mdpi.com', false, '/1111-0000/18/8')).toBeNull();
    expect(findSpots('https://www.mdpi.com/1111-0000/18/8')).toEqual([]);
  });
});

// ---- Remembering what was saved ------------------------------------------------------------------

describe('what this browser saved', () => {
  it('is kept per thesis by identifier, newest last, within its limits', () => {
    let store = remember(undefined, DOC, ['doi:10.5555/a']);
    store = remember(store, DOC, ['doi:10.5555/b', 'doi:10.5555/a']);
    expect(store[DOC]).toEqual(['doi:10.5555/b', 'doi:10.5555/a']);
    expect(wasSaved(store, DOC, ['doi:10.5555/a'])).toBe(true);
    expect(wasSaved(store, 'another', ['doi:10.5555/a'])).toBe(false);
    expect(wasSaved('rubbish', DOC, ['doi:10.5555/a'])).toBe(false);

    const many = Array.from({ length: PER_THESIS + 5 }, (_, i) => `doi:10.5555/${i}`);
    expect(remember(undefined, DOC, many)[DOC]).toHaveLength(PER_THESIS);
    let theses = {};
    for (let i = 0; i < THESES + 3; i += 1) theses = remember(theses, `thesis-${i}`, ['k']);
    expect(Object.keys(theses)).toHaveLength(THESES);
    expect(Object.keys(theses)).not.toContain('thesis-0');
  });

  it('keys a paper by its identifiers, else by its title', () => {
    expect(
      paperKeys({ refs: [{ kind: 'arxiv', id: '2501.02840' }], doi: '10.48550/arXiv.2501.02840' }),
    ).toEqual(['arxiv:2501.02840', 'doi:10.48550/arxiv.2501.02840']);
    expect(paperKeys({ refs: [], doi: null, title: 'Groundwater markets in South India' })).toEqual(
      ['title:groundwater markets in south india'],
    );
  });

  it('a page visited again marks the buttons of papers saved into the current thesis', async () => {
    load('mdpi-search.html');
    const stored: Record<string, unknown> = {
      lastDocumentId: DOC,
      [SAVED_KEY]: { [DOC]: ['doi:10.5555/rs17071221'] },
    };
    const { deps } = fake(signedIn, stored);
    const run = startInpage(deps, () => 'https://www.mdpi.com/search?q=rooftop');
    await settle();
    const labels = Array.from(document.querySelectorAll('[data-tc-addon="button"]')).map(
      (host) => shadowOf(host)?.querySelector('button')?.textContent,
    );
    expect(labels).toEqual([
      'Add to Thesis Copilot',
      'Saved to Thesis Copilot',
      'Add to Thesis Copilot',
    ]);
    run.stop();
  });

  it('a save from the card is remembered, by the identifier it went in by as well', async () => {
    load('mdpi-search.html');
    const stored: Record<string, unknown> = {};
    const { deps } = fake(
      {
        ...signedIn,
        lookup: () => ({
          ok: true,
          value: { ...PREVIEW, doi: '10.5555/en18081921', title: 'Performance' },
        }),
        'save-one': () => ({
          ok: true,
          value: {
            key: 'one',
            status: 'saved',
            sourceId: SOURCE,
            collection: null,
            signedOut: false,
            via: 'id',
          },
        }),
      },
      stored,
    );
    const [spot] = findSpots('https://www.mdpi.com/search?q=rooftop');
    if (!spot) throw new Error('no spot');
    const card = createCard(deps);
    card.open(spot.item, null);
    await settle();
    q(root(card.host), 'tc-save')?.click();
    await settle();
    expect(wasSaved(stored[SAVED_KEY], DOC, ['doi:10.5555/en18081921'])).toBe(true);
    expect(stored.lastDocumentId).toBe(DOC);
  });
});
