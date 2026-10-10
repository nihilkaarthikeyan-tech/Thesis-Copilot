/**
 * ADR-0147: dashes used as punctuation and stock phrases in the stored evaluation outputs, by
 * generation path. No model call; reads `eval/results/*.json`.
 *
 *   pnpm --filter @tc/ai exec tsx eval/style-measure.ts [--since 2026-10-09] [--file <name>] [--processed]
 *
 * Counted on what the model wrote (`aRaw`/`bRaw`: before post-processing, so the prompt's own
 * behaviour), and on what the student would see after `academicPunctuation` (the backstop).
 * Side A is the prompt on disk at the time of the run; side B a candidate or another model.
 *
 * `--processed` (ADR-0147 round 2) counts the text the student was offered instead (`a`/`b`: after
 * post-processing, so after `dropConnectiveOpeners`), with its rendered "(Author year)" citations
 * left out of the word count.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { academicPunctuation, countDashes, stockPhrases } from '../src/builder/academic-style.js';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (flag: string) =>
  process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : undefined;
const since = arg('--since');
const onlyFile = arg('--file');
const processed = process.argv.includes('--processed');

/** Paths whose output is thesis prose or an answer in prose. */
const PROSE = new Set(['assist', 'draft', 'chat', 'chat_deep', 'command', 'revise']);

type Tally = {
  files: number;
  outputs: number;
  withDash: number;
  dashes: number;
  dashesAfter: number;
  stock: number;
  withStock: number;
  words: number;
  labels: Record<string, number>;
};
const blank = (): Tally => ({
  files: 0,
  outputs: 0,
  withDash: 0,
  dashes: 0,
  dashesAfter: 0,
  stock: 0,
  withStock: 0,
  words: 0,
  labels: {},
});

const byPath = new Map<string, { a: Tally; b: Tally }>();
for (const file of readdirSync(join(here, 'results')).sort()) {
  if (!file.endsWith('.json')) continue;
  if (onlyFile && !file.includes(onlyFile)) continue;
  const stamp = /(\d{4}-\d{2}-\d{2})-\d{2}-\d{2}\.json$/.exec(file)?.[1] ?? '';
  if (since && stamp < since) continue;
  const path = file.split('-')[0] as string;
  if (!PROSE.has(path)) continue;
  const data = JSON.parse(readFileSync(join(here, 'results', file), 'utf8')) as {
    rows?: Array<Record<string, unknown>>;
  };
  const entry = byPath.get(path) ?? { a: blank(), b: blank() };
  byPath.set(path, entry);
  const bOnly = file.includes('measured') && (data.rows ?? []).every((r) => !r.aRaw);
  for (const side of ['a', 'b'] as const) {
    if (side === 'a' && bOnly) continue;
    entry[side].files++;
    for (const row of data.rows ?? []) {
      const raw = processed
        ? String(row[side] ?? '').replace(/\([^()]*\b(?:\d{4}|n\.d\.)[a-z]?\)/g, ' ')
        : String(row[`${side}Raw`] ?? '');
      if (!raw.trim() || raw.startsWith('FAILED')) continue;
      const t = entry[side];
      t.outputs++;
      const d = countDashes(raw);
      t.dashes += d;
      if (d > 0) t.withDash++;
      t.dashesAfter += countDashes(academicPunctuation(raw));
      const found = stockPhrases(raw);
      t.stock += found.length;
      if (found.length > 0) t.withStock++;
      for (const l of found) t.labels[l] = (t.labels[l] ?? 0) + 1;
      t.words += raw
        .replace(/\{\{[^}]*\}\}/g, ' ')
        .split(/\s+/)
        .filter(Boolean).length;
    }
  }
}

const per1k = (n: number, words: number) => (words ? +((n / words) * 1000).toFixed(2) : 0);
const report = Object.fromEntries(
  [...byPath.entries()].map(([path, sides]) => [
    path,
    Object.fromEntries(
      (['a', 'b'] as const).map((k) => {
        const t = sides[k];
        return [
          k === 'a' ? 'current' : 'candidate',
          {
            files: t.files,
            outputs: t.outputs,
            outputsWithDash: t.withDash,
            dashes: t.dashes,
            dashesPerOutput: t.outputs ? +(t.dashes / t.outputs).toFixed(3) : 0,
            dashesPer1kWords: per1k(t.dashes, t.words),
            dashesAfterBackstop: t.dashesAfter,
            stockPhrases: t.stock,
            outputsWithStock: t.withStock,
            stockPer1kWords: per1k(t.stock, t.words),
            words: t.words,
            labels: t.labels,
          },
        ];
      }),
    ),
  ]),
);
console.log(JSON.stringify(report, null, 2));
