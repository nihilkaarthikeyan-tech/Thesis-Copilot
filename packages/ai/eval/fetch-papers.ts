/**
 * Real papers for the prompt evaluation (ADR-0038, 2026-09-30).
 *
 * For each topic, the most relevant works with an abstract from OpenAlex, saved exactly as
 * OpenAlex returns them (the abstract rebuilt from its inverted index). Nothing here is written
 * by hand: an evaluation on invented sources would measure nothing.
 *
 *   pnpm --filter @tc/ai exec dotenv -e ../../.env -- tsx eval/fetch-papers.ts
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOPICS } from './topics.js';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, 'papers');
const mailto = process.env.OPENALEX_MAILTO ?? 'eval@example.com';
const key = process.env.OPENALEX_API_KEY;

type Work = {
  id: string;
  doi: string | null;
  title: string;
  publication_year: number | null;
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

mkdirSync(OUT, { recursive: true });
for (const topic of TOPICS) {
  const url =
    `https://api.openalex.org/works?search=${encodeURIComponent(topic.search)}` +
    '&filter=has_abstract:true,type:article&per-page=12' +
    `&mailto=${encodeURIComponent(mailto)}${key ? `&api_key=${key}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OpenAlex ${res.status} for ${topic.id}`);
  const body = (await res.json()) as { results: Work[] };
  const papers = body.results
    .map((w) => ({
      openalexId: w.id,
      doi: w.doi?.replace('https://doi.org/', '') ?? null,
      title: w.title,
      year: w.publication_year,
      authors: w.authorships.slice(0, 6).map((a) => a.author.display_name),
      venue: w.primary_location?.source?.display_name ?? null,
      abstract: abstractOf(w.abstract_inverted_index),
    }))
    .filter((p) => p.abstract.split(/\s+/).length >= 80)
    .slice(0, 8);
  writeFileSync(join(OUT, `${topic.id}.json`), `${JSON.stringify(papers, null, 2)}\n`);
  console.log(topic.id, papers.length, 'papers');
}
