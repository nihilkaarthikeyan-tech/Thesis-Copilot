/**
 * ADR-0135: fresh 15-paper libraries for the Start-writing-now opener (`run.ts --set opener`).
 *
 * For each `FRESH` topic: two OpenAlex searches (the title's own words, and the same subject
 * without the place, as the product's angle queries search), works from 2021 on with an abstract
 * of 60+ words, merged by DOI. Each abstract is embedded (the configured embedding model) and the
 * 15 nearest the thesis title are kept, as the paper pool keeps the papers nearest the scope.
 * Then the two retrieval queries the opener can send are ranked as `retrievePassages` ranks them
 * (`buildQueryText` + cosine + `credibility`; an abstract is one chunk, so the per-paper cap does
 * not bite):
 *
 *   chapter1  — today: the heading "Chapter 1" and no scope note, so the query is "Chapter 1".
 *   titled    — ADR-0135's retrieval change: the thesis's working title stands in for the empty
 *               scope note.
 *
 * Nothing is written by hand: titles, authors, years and abstracts are OpenAlex's.
 *
 *   pnpm --filter @tc/ai exec tsx --env-file=../../.env eval/fetch-fresh.ts
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '@tc/config';
import { buildQueryText, credibility } from '../../retrieval/src/rank.js';
import { createProviders } from '../src/factory.js';
import { FRESH } from './topics.js';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, 'papers');
const mailto = process.env.OPENALEX_MAILTO ?? 'eval@example.com';
const key = process.env.OPENALEX_API_KEY;

type Work = {
  id: string;
  doi: string | null;
  title: string;
  publication_year: number | null;
  cited_by_count: number | null;
  type: string;
  authorships: Array<{ author: { display_name: string } }>;
  abstract_inverted_index: Record<string, number[]> | null;
  primary_location?: { source?: { display_name?: string } | null } | null;
};

function abstractOf(index: Record<string, number[]> | null): string {
  if (!index) return '';
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const p of positions) words[p] = word;
  }
  return words.filter(Boolean).join(' ');
}

function cos(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    na += (a[i] ?? 0) ** 2;
    nb += (b[i] ?? 0) ** 2;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

async function search(q: string): Promise<Work[]> {
  const url =
    `https://api.openalex.org/works?search=${encodeURIComponent(q)}` +
    '&filter=has_abstract:true,from_publication_date:2021-01-01,type:article|review&per-page=25' +
    `&mailto=${encodeURIComponent(mailto)}${key ? `&api_key=${key}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OpenAlex ${res.status} for ${q}`);
  return ((await res.json()) as { results: Work[] }).results;
}

const env = loadEnv();
const { embeddings } = createProviders(env);
mkdirSync(OUT, { recursive: true });

for (const topic of FRESH) {
  const seen = new Set<string>();
  const works: Work[] = [];
  for (const q of [topic.search, topic.broad]) {
    for (const w of await search(q)) {
      const k = (w.doi ?? w.title ?? w.id).toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      works.push(w);
    }
  }
  const papers = works
    .map((w) => ({
      openalexId: w.id,
      doi: w.doi?.replace('https://doi.org/', '') ?? null,
      title: w.title,
      year: w.publication_year,
      citationCount: w.cited_by_count,
      authors: w.authorships.slice(0, 6).map((a) => a.author.display_name),
      venue: w.primary_location?.source?.display_name ?? null,
      abstract: abstractOf(w.abstract_inverted_index),
    }))
    .filter((p) => p.title && p.abstract.split(/\s+/).length >= 60);

  const queries = {
    chapter1: buildQueryText('Chapter 1\n', null),
    titled: buildQueryText('Chapter 1\n', topic.thesisTitle),
  };
  const vectors = await embeddings.embed([
    topic.thesisTitle,
    queries.chapter1,
    queries.titled,
    ...papers.map((p) => `${p.title}\n${p.abstract}`),
  ]);
  const [titleV, chapter1V, titledV, ...paperV] = vectors as number[][];
  const pool = papers
    .map((p, i) => ({ ...p, toTitle: cos(titleV as number[], paperV[i] as number[]) }))
    .sort((a, b) => b.toTitle - a.toTitle)
    .slice(0, 15);
  const poolV = pool.map((p) => paperV[papers.findIndex((x) => x.title === p.title)] as number[]);
  const rank = (q: number[]) =>
    pool
      .map((p, i) => ({
        i,
        score:
          cos(q, poolV[i] as number[]) +
          credibility({ citationCount: p.citationCount, year: p.year }),
      }))
      .sort((a, b) => b.score - a.score)
      .map((r) => r.i);
  const out = {
    topic: topic.id,
    queries,
    papers: pool,
    rankings: { chapter1: rank(chapter1V as number[]), titled: rank(titledV as number[]) },
  };
  writeFileSync(join(OUT, `${topic.id}.json`), `${JSON.stringify(out, null, 2)}\n`);
  console.log(
    topic.id,
    `${works.length} found, ${papers.length} with abstracts, pool ${pool.length}`,
    '\n  chapter1 top 6:',
    out.rankings.chapter1
      .slice(0, 6)
      .map((i) => pool[i]?.title.slice(0, 60))
      .join(' | '),
    '\n  titled top 6:',
    out.rankings.titled
      .slice(0, 6)
      .map((i) => pool[i]?.title.slice(0, 60))
      .join(' | '),
  );
}
