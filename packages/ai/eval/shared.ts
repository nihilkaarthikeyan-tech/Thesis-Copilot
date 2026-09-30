/** Cases and helpers shared by the evaluation harnesses (ADR-0038). */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PromptPassage } from '../src/builder/assist.js';
import { buildMemoryBlock } from '../src/builder/memory.js';
import { splitSentences } from '../src/builder/quality.js';
import type { Topic } from './topics.js';

const here = dirname(fileURLToPath(import.meta.url));

export type Paper = {
  doi: string | null;
  title: string;
  year: number | null;
  authors: string[];
  venue: string | null;
  abstract: string;
};

export function papersFor(topic: Topic): Paper[] {
  return JSON.parse(readFileSync(join(here, 'papers', `${topic.id}.json`), 'utf8')) as Paper[];
}

export function shortRef(p: Paper): string {
  const last = (p.authors[0] ?? 'Anon').split(/\s+/).pop() ?? 'Anon';
  const etal =
    p.authors.length > 2
      ? ' et al.'
      : p.authors.length === 2
        ? ` & ${p.authors[1]?.split(/\s+/).pop()}`
        : '';
  return `${last}${etal} ${p.year ?? 'n.d.'}`;
}

export function passagesFor(topic: Topic, count: number): PromptPassage[] {
  return papersFor(topic)
    .slice(0, count)
    .map((p, i) => ({ id: `S${i + 1}#c1`, shortRef: shortRef(p), page: null, text: p.abstract }));
}

export function memoryFor(topic: Topic, chapterText: string): string {
  return buildMemoryBlock({
    scope: {
      workingTitle: topic.thesisTitle,
      problemStatement: topic.chapter.scopeNote,
      objectives: [topic.section.scopeNote],
      whyOpen: '',
    },
    outline: [
      {
        id: 'ch-review',
        title: topic.chapter.title,
        scopeNote: topic.chapter.scopeNote,
        children: [
          {
            id: 'sec-1',
            title: topic.section.title,
            scopeNote: topic.section.scopeNote,
            children: [],
          },
        ],
      },
    ],
    glossary: {},
    styleProfile: null,
    chapter: { outlineNodeId: 'ch-review', text: chapterText },
  }).text;
}

/** `{{cite:S2#c1}}` → "(Kumar et al. 2021)", as the student would read it. */
export function readable(text: string, passages: readonly PromptPassage[]): string {
  return text.replace(/\{\{cite:([^}]+)\}\}/g, (_, id: string) => {
    const p = passages.find((x) => x.id === id.trim());
    return p ? `(${p.shortRef})` : '';
  });
}

/**
 * A drafted Literature Review section for the topic: the current draft prompt's first answer in
 * the round-1 draft evaluation (eval/results/draft-2026-09-30-12-22.json), used as the student's
 * own thesis text where a task needs one (viva, revision, outline coverage). `raw` keeps the
 * `{{cite:ID}}` markers; `shown` is as the student reads it.
 */
export function draftedSection(topic: Topic): { raw: string; shown: string } {
  const file = join(here, 'results', 'draft-2026-09-30-12-22.json');
  const rows = (JSON.parse(readFileSync(file, 'utf8')) as { rows: Array<Record<string, unknown>> })
    .rows;
  const row = rows.find((r) => r.case === topic.id && r.sample === 0) as
    | { aRaw: string; a: string }
    | undefined;
  if (!row) throw new Error(`No drafted section for ${topic.id}`);
  return { raw: row.aRaw, shown: row.a };
}

/** Real model sentences carrying a citation, from the round-1 assist evaluation. */
export function citedSentences(): Array<{ topic: string; sentence: string }> {
  const file = join(here, 'results', 'assist-2026-09-30-12-21.json');
  const rows = (JSON.parse(readFileSync(file, 'utf8')) as { rows: Array<Record<string, unknown>> })
    .rows;
  const out: Array<{ topic: string; sentence: string }> = [];
  for (const row of rows as Array<{ case: string; sample: number; bRaw: string }>) {
    if (row.sample !== 0) continue;
    const first = splitSentences(row.bRaw)[0]?.trim() ?? '';
    if (/\{\{cite:[^}]+\}\}/.test(first) && first.length > 40) {
      out.push({ topic: row.case.replace(/-\d+$/, ''), sentence: first });
    }
  }
  return out;
}
