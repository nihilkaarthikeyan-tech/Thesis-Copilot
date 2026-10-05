/**
 * Real papers for the copying round (ADR-0075, 2026-10-05), from Crossref.
 *
 * The side-by-side study (docs/research/side-by-side-2026-10-05.md §4) caught Assist reusing the
 * wording of Bagla (2026) on rooftop solar in Karnataka. OpenAlex (`fetch-papers.ts`) had no
 * budget left that day, so this topic's papers come from Crossref, which carries the publisher's
 * own abstract. Saved as Crossref returns them, JATS tags removed; nothing is written by hand.
 *
 *   pnpm --filter @tc/ai exec tsx eval/fetch-crossref.ts
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, 'papers');

/** The paper the production suggestion copied from, always included first. */
const BAGLA_DOI = '10.46609/ijsser.2026.v11i08.043';
const SEARCH = 'rooftop solar adoption households Karnataka India barriers subsidy';

type Item = {
  DOI: string;
  title?: string[];
  author?: Array<{ given?: string; family?: string; name?: string }>;
  abstract?: string;
  published?: { 'date-parts'?: number[][] };
  'container-title'?: string[];
};

function clean(abstract: string): string {
  return abstract
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\s*Abstract\s*/i, '')
    .trim();
}

function paper(item: Item) {
  return {
    doi: item.DOI,
    title: item.title?.[0] ?? '',
    year: item.published?.['date-parts']?.[0]?.[0] ?? null,
    authors: (item.author ?? [])
      .slice(0, 6)
      .map((a) => a.name ?? [a.given, a.family].filter(Boolean).join(' ')),
    venue: item['container-title']?.[0] ?? null,
    abstract: clean(item.abstract ?? ''),
  };
}

const select = 'DOI,title,author,abstract,published,container-title';
const one = (await (await fetch(`https://api.crossref.org/works/${BAGLA_DOI}`)).json()) as {
  message: Item;
};
const res = await fetch(
  `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(SEARCH)}&filter=has-abstract:true,type:journal-article&rows=30&select=${select}`,
);
if (!res.ok) throw new Error(`Crossref ${res.status}`);
const body = (await res.json()) as { message: { items: Item[] } };

const papers = [paper(one.message)];
for (const item of body.message.items) {
  const p = paper(item);
  if (p.doi === BAGLA_DOI || p.abstract.split(/\s+/).length < 80) continue;
  if (!/solar|photovoltaic|\bPV\b/i.test(`${p.title} ${p.abstract}`)) continue;
  papers.push(p);
  if (papers.length >= 6) break;
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'rooftop-solar-karnataka.json'), `${JSON.stringify(papers, null, 2)}\n`);
console.log(papers.map((p) => `${p.year} ${p.title}`).join('\n'));
