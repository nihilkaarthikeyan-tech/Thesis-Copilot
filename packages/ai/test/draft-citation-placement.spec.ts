/**
 * ADR-0155 item 2 (the Word test, 2026-10-16): in a drafted section the citation sat after the
 * full stop ("…in Karnataka. (Bagla, 2026)"), because ADR-0150's placement ran for Assist only.
 * Draft a section, chapter build and the literature review all go through `postProcessDraft`.
 *
 * Measured on the real draft outputs stored by the prompt evaluations (`eval/results/draft*`):
 * before this fix most of their markers followed a full stop.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { PromptPassage } from '../src/builder/assist.js';
import { placeDraftCitations } from '../src/builder/citation-placement.js';
import { postProcessCommand } from '../src/builder/command.js';
import { postProcessDraft } from '../src/builder/draft.js';
import { stripCites } from '../src/checks/text.js';

const RESULTS = fileURLToPath(new URL('../eval/results/', import.meta.url));
/**
 * A marker run right after a sentence's terminator that closes it (the end, a new paragraph or
 * the next sentence follows): the fault. A marker that is the subject of the next sentence
 * ("{{cite:S1#c1}} reports that…") is not one.
 */
const AFTER_STOP =
  /[.!?]["'”’)\]]*[ \t]*(?:\{\{cite:[^}]+\}\}[ \t]*)+(?=\s*$|\s+[\p{Lu}\p{N}"“([#])/gu;
const MARKER = /\{\{cite:([^}]+)\}\}/g;

type Row = { aRaw?: unknown; bRaw?: unknown };
function storedOutputs(prefix: string): string[] {
  return readdirSync(RESULTS)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
    .flatMap((f) => {
      const data = JSON.parse(readFileSync(join(RESULTS, f), 'utf8')) as { rows: Row[] };
      return data.rows.flatMap((row) =>
        [row.aRaw, row.bRaw].filter(
          (raw): raw is string => typeof raw === 'string' && raw.includes('{{cite:'),
        ),
      );
    });
}

const passagesOf = (text: string): PromptPassage[] =>
  [...new Set([...text.matchAll(MARKER)].map((m) => (m[1] ?? '').trim()))].map((id) => ({
    id,
    shortRef: 'Author 2024',
    page: null,
    text: 'A passage.',
  }));

const markers = (text: string) => [...text.matchAll(MARKER)].map((m) => m[1]).sort();

describe('citations inside the full stop in a drafted section (ADR-0155)', () => {
  const drafts = storedOutputs('draft');

  it('the stored drafts show the fault before the fix', () => {
    expect(drafts.length).toBeGreaterThan(20);
    const faulty = drafts.filter((d) => d.match(AFTER_STOP) !== null);
    expect(faulty.length).toBeGreaterThan(drafts.length / 2);
  });

  it('postProcessDraft leaves no marker after a full stop in any stored draft', () => {
    for (const raw of drafts) {
      const out = postProcessDraft(raw, passagesOf(raw), 100).result.markdown;
      expect(out.match(AFTER_STOP), out.slice(0, 300)).toBeNull();
    }
  });

  it('moves markers, never adds, drops or swaps one', () => {
    for (const raw of drafts) {
      expect(markers(placeDraftCitations(raw))).toEqual(markers(raw));
    }
  });

  it('the paragraph from the Word file', () => {
    const raw =
      'Bagla finds that progression from awareness to installation often stalls in Karnataka. {{cite:S1#c1}}\n\n' +
      '### 1.2 Objectives\n\n' +
      'Survey evidence indicates low awareness. {{cite:S2#c1}} At the same time, national goals frame the stakes. {{cite:S3#c1}}{{cite:S2#c2}}';
    expect(placeDraftCitations(raw)).toBe(
      'Bagla finds that progression from awareness to installation often stalls in Karnataka {{cite:S1#c1}}.\n\n' +
        '### 1.2 Objectives\n\n' +
        'Survey evidence indicates low awareness {{cite:S2#c1}}. At the same time, national goals frame the stakes {{cite:S3#c1}}{{cite:S2#c2}}.',
    );
  });

  it('one paper cited in two sentences of a draft keeps both citations', () => {
    const raw = 'Cost limits uptake. {{cite:S1#c1}} Awareness is low. {{cite:S1#c1}}';
    expect(placeDraftCitations(raw)).toBe(
      'Cost limits uptake {{cite:S1#c1}}. Awareness is low {{cite:S1#c1}}.',
    );
  });

  it('edit commands already place them (citationsBeforeStop), on their stored outputs', () => {
    for (const raw of storedOutputs('command')) {
      const out = postProcessCommand(raw, '', [...new Set(markers(raw))] as string[]).text;
      expect(out.match(/[.!?][ \t]+\{\{cite:/g), out.slice(0, 300)).toBeNull();
    }
  });

  it('a stop already after the marker is not doubled ("percent (X)..")', () => {
    expect(placeDraftCitations('Wear fell by twelve percent. {{cite:S1#c1}}. Next.')).toBe(
      'Wear fell by twelve percent {{cite:S1#c1}}. Next.',
    );
  });

  it('chapter build reads a sentence without its markers as "recorded.", not "recorded ."', () => {
    expect(stripCites('The rate was recorded {{cite:S1#c1}}{{cite:S2#c1}}.')).toBe(
      'The rate was recorded.',
    );
  });
});
