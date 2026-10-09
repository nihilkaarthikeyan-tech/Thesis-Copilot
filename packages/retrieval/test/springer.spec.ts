/**
 * Springer Nature Open Access API — ADR-0134.
 *
 * The fixtures are real responses recorded from the live API on 2026-10-09 with the owner's key
 * (`test/fixtures/scholarly/springer-*`, key removed): `/openaccess/jats` for a BMC article, a
 * Springer "Discover" article, a Nature Communications article and a hybrid open-access article
 * in a subscription journal (Annals of Operations Research), the JSON record for the BMC one, and
 * the 404 body every closed or unknown DOI gets.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { chunkText } from '../src/chunker.js';
import {
  dailyAllowance,
  isSpringerNatureDoi,
  readArticle,
  SPRINGER_COOL_OFF_MS,
  SpringerNatureClient,
} from '../src/scholarly/springer.js';

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/scholarly/${name}`, import.meta.url), 'utf8');

const BMC = {
  doi: '10.1186/s12889-020-09301-4',
  xml: fixture('springer-jats-s12889-020-09301-4.xml'),
};
const FOOD = {
  doi: '10.1007/s44187-024-00103-w',
  xml: fixture('springer-jats-s44187-024-00103-w.xml'),
};
const NCOMMS = {
  doi: '10.1038/s41467-022-33407-5',
  xml: fixture('springer-jats-s41467-022-33407-5.xml'),
};
const HYBRID = {
  doi: '10.1007/s10479-024-06355-0',
  xml: fixture('springer-jats-s10479-024-06355-0.xml'),
};
const NOT_FOUND = fixture('springer-jats-not-found.json');
const KEY = 'test-key-123';

const xmlResponse = (body: string) =>
  new Response(body, { status: 200, headers: { 'content-type': 'application/xml' } });
const status = (code: number, body = '{}', headers: Record<string, string> = {}) =>
  new Response(body, { status: code, headers });

function client(
  respond: (url: string) => Response | Promise<Response>,
  extra: { now?: () => number; allowance?: () => Promise<boolean> } = {},
) {
  const fetchFn = vi.fn(async (url: string) => respond(url));
  const sleep = vi.fn(async () => {});
  return {
    fetchFn,
    sleep,
    sn: new SpringerNatureClient(KEY, { fetch: fetchFn, sleep, ...extra }),
  };
}

describe('readArticle on real Springer Nature JATS', () => {
  for (const paper of [BMC, FOOD, NCOMMS, HYBRID]) {
    it(`reads ${paper.doi} into sections, without references or markup`, () => {
      const out = readArticle(paper.xml, paper.doi);
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      const names = [...new Set(out.sections.map((s) => s.section))];
      expect(names[0]).toBe('Abstract');
      expect(names.length).toBeGreaterThanOrEqual(4);
      expect(out.text).not.toMatch(/<[a-z]/i);
      expect(out.license).toMatch(/^http:\/\/creativecommons\.org\/licenses\//);
      expect(out.url).toBe(`https://doi.org/${paper.doi}`);
      // The spans cover the text and feed the chunker.
      const last = out.sections[out.sections.length - 1];
      expect(last?.end).toBe(out.text.length);
      const chunks = chunkText({ text: out.text, sections: out.sections });
      expect(chunks.length).toBeGreaterThan(5);
      expect(chunks.every((c) => c.page === null || c.page === undefined)).toBe(true);
    });
  }

  it('names the BMC article by its own top-level headings', () => {
    const out = readArticle(BMC.xml, BMC.doi);
    if (!out.ok) throw new Error('expected text');
    expect([...new Set(out.sections.map((s) => s.section))]).toEqual([
      'Abstract',
      'Background',
      'Methods',
      'Results',
      'Discussion',
      'Conclusion',
    ]);
  });

  it('keeps figure captions and tables, drops the reference list', () => {
    const bmc = readArticle(BMC.xml, BMC.doi);
    if (!bmc.ok) throw new Error('expected text');
    expect(bmc.text).toContain('Fig. 1. PRISMA flow diagram illustrating study selection');
    expect(bmc.text).toContain('Table 1. Summary characteristic of included studies');
    // A reference-list entry, present in the XML's <back>, is not in the text.
    expect(BMC.xml).toContain('Identification of a new human coronavirus');
    expect(bmc.text).not.toContain('Identification of a new human coronavirus');
    expect(bmc.text).not.toContain('Acknowledgements');

    const food = readArticle(FOOD.xml, FOOD.doi);
    if (!food.ok) throw new Error('expected text');
    expect(food.text).toMatch(
      /\nSample \| Total carbohydrates \(g\/100 g DW\) \| Total fat \(g\/100 g DW\) \|/,
    );
  });

  it('reads a bulleted list inside a paragraph whole, and keeps MathML but not the LaTeX preamble', () => {
    const out = readArticle(HYBRID.xml, HYBRID.doi);
    if (!out.ok) throw new Error('expected text');
    expect(HYBRID.xml).toContain('\\documentclass[12pt]{minimal}');
    expect(out.text).not.toContain('documentclass');
    expect(out.text).not.toContain('usepackage');
    // Par36 introduces a list whose first item is Par37: one paragraph, not one cut at the item.
    expect(out.text).toMatch(
      /two relevant observations ought to be addressed: First, the bootstrap methodology/,
    );
  });

  it('reads a list that stands alone, item by item', () => {
    const xml =
      '<article><front><article-meta><article-id pub-id-type="doi">10.1007/x1</article-id>' +
      '<permissions><license license-type="open-access" xlink:href="http://creativecommons.org/licenses/by/4.0/">' +
      '<license-p>CC BY</license-p></license></permissions></article-meta></front>' +
      '<body><sec><title>Methods</title><p>We did three things.</p>' +
      '<list list-type="bullet"><list-item><p>Sampled.</p></list-item><list-item><p>Weighed.</p></list-item>' +
      '</list></sec></body></article>';
    const out = readArticle(xml, '10.1007/x1');
    if (!out.ok) throw new Error(`expected text, got ${out.reason}`);
    expect(out.text).toBe('We did three things.\n\nSampled.\n\nWeighed.');
  });

  it('wants the DOI asked for, exactly', () => {
    expect(readArticle(BMC.xml, FOOD.doi)).toEqual({ ok: false, reason: 'no-record' });
    expect(readArticle(BMC.xml, BMC.doi.toUpperCase()).ok).toBe(true);
  });

  it('refuses a record without an open-access licence', () => {
    const closed = BMC.xml.replace('license-type="open-access"', 'license-type="other"');
    expect(readArticle(closed, BMC.doi)).toEqual({ ok: false, reason: 'not-open-access' });
  });

  it('refuses a record with no body: an abstract is not full text', () => {
    const bare = BMC.xml.replace(/<body>[\s\S]*<\/body>/, '');
    expect(readArticle(bare, BMC.doi)).toEqual({ ok: false, reason: 'no-body' });
  });
});

describe('SpringerNatureClient', () => {
  it('asks /openaccess/jats for the DOI with the key, and returns the article', async () => {
    const { sn, fetchFn } = client(() => xmlResponse(BMC.xml));
    const out = await sn.fullText(`https://doi.org/${BMC.doi}`);
    expect(out.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe(
      `https://api.springernature.com/openaccess/jats?q=doi%3A10.1186%2Fs12889-020-09301-4&api_key=${KEY}`,
    );
  });

  it('a 404 (closed, or no such DOI) is no-record, not an error', async () => {
    const { sn } = client(() => status(404, NOT_FOUND));
    expect(await sn.fullText(BMC.doi)).toEqual({ ok: false, reason: 'no-record', status: 404 });
  });

  it('a refused key is unauthorized and is not retried', async () => {
    const { sn, fetchFn } = client(() => status(401));
    expect(await sn.fullText(BMC.doi)).toMatchObject({ ok: false, reason: 'unauthorized' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('a 429 is not retried, and the client leaves the API alone until the wait is over', async () => {
    let now = 1_000_000;
    const { sn, fetchFn } = client(() => status(429), { now: () => now });
    expect(await sn.fullText(BMC.doi)).toMatchObject({ ok: false, reason: 'rate-limited' });
    expect(await sn.fullText(FOOD.doi)).toEqual({ ok: false, reason: 'rate-limited' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    now += SPRINGER_COOL_OFF_MS + 1;
    await sn.fullText(FOOD.doi);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("honours a 429's Retry-After when it gives one", async () => {
    let now = 1_000_000;
    const { sn, fetchFn } = client(() => status(429, '{}', { 'retry-after': '30' }), {
      now: () => now,
    });
    await sn.fullText(BMC.doi);
    now += 31_000;
    await sn.fullText(BMC.doi);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('retries a 5xx once, then gives up with error', async () => {
    const { sn, fetchFn } = client(() => status(503));
    expect(await sn.fullText(BMC.doi)).toMatchObject({ ok: false, reason: 'error', status: 503 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('retries a network fault once and succeeds', async () => {
    let calls = 0;
    const { sn } = client(() => {
      calls++;
      if (calls === 1) throw new TypeError('fetch failed');
      return xmlResponse(BMC.xml);
    });
    expect((await sn.fullText(BMC.doi)).ok).toBe(true);
  });

  it('a timeout is reported as timeout, not retried', async () => {
    const controller = new AbortController();
    const { sn, fetchFn } = client(() => {
      controller.abort();
      throw new DOMException('timed out', 'TimeoutError');
    });
    expect(await sn.fullText(BMC.doi, controller.signal)).toEqual({
      ok: false,
      reason: 'timeout',
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('sends nothing once the daily allowance says no', async () => {
    const { sn, fetchFn } = client(() => xmlResponse(BMC.xml), {
      allowance: async () => false,
    });
    expect(await sn.fullText(BMC.doi)).toEqual({ ok: false, reason: 'daily-limit' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('never returns the key, whatever goes wrong', async () => {
    for (const respond of [
      () => status(500, `boom ${KEY}`),
      () => status(401, KEY),
      () => {
        throw new Error(`fetch failed for ...api_key=${KEY}`);
      },
    ]) {
      const { sn } = client(respond);
      expect(JSON.stringify(await sn.fullText(BMC.doi))).not.toContain(KEY);
    }
  });

  it('will not be built without a key', () => {
    expect(() => new SpringerNatureClient('')).toThrow();
  });
});

describe('isSpringerNatureDoi', () => {
  it('knows Springer Nature by DOI prefix', () => {
    for (const doi of [
      '10.1007/s44187-024-00103-w',
      '10.1186/s12889-020-09301-4',
      '10.1038/s41467-022-33407-5',
      '10.1140/epjc/s10052-024-12995-0',
      '10.1057/s41599-020-0523-3',
      'https://doi.org/10.1186/S12889-020-09301-4',
    ]) {
      expect(isSpringerNatureDoi(doi)).toBe(true);
    }
  });

  it('leaves other publishers alone, and Research Square preprints', () => {
    expect(isSpringerNatureDoi('10.1371/journal.pone.0185809')).toBe(false);
    expect(isSpringerNatureDoi('10.1016/j.cell.2020.01.001')).toBe(false);
    expect(isSpringerNatureDoi('10.21203/rs.3.rs-23906/v1')).toBe(false);
    expect(isSpringerNatureDoi(null)).toBe(false);
    expect(isSpringerNatureDoi('not a doi')).toBe(false);
  });

  it("falls back on Crossref's member or publisher field for an unlisted prefix", () => {
    expect(isSpringerNatureDoi('10.99999/x1', { member: '297' })).toBe(true);
    expect(
      isSpringerNatureDoi('10.99999/x1', { publisher: 'Springer Science and Business Media LLC' }),
    ).toBe(true);
    expect(isSpringerNatureDoi('10.99999/x1', { publisher: 'Elsevier BV', member: '78' })).toBe(
      false,
    );
  });
});

describe('dailyAllowance', () => {
  it('counts per UTC day in the store and stops at the limit', async () => {
    const counts = new Map<string, number>();
    const expires: string[] = [];
    const store = {
      incr: async (key: string) => {
        const n = (counts.get(key) ?? 0) + 1;
        counts.set(key, n);
        return n;
      },
      expire: async (key: string) => {
        expires.push(key);
        return 1;
      },
    };
    let now = Date.UTC(2026, 9, 9, 23, 59);
    const allow = dailyAllowance(store, 'scholarly:springer', 2, () => now);
    expect(await allow()).toBe(true);
    expect(await allow()).toBe(true);
    expect(await allow()).toBe(false);
    now = Date.UTC(2026, 9, 10, 0, 1);
    expect(await allow()).toBe(true);
    expect([...counts.keys()]).toEqual([
      'scholarly:springer:2026-10-09',
      'scholarly:springer:2026-10-10',
    ]);
    expect(expires).toEqual([...counts.keys()]);
  });
});
