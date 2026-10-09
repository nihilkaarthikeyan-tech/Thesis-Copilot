/**
 * A style with no bibliography — QA 2026-10-09.
 *
 * Choosing "Chicago Manual of Style 18th edition (notes without bibliography)" (`chicago-notes`)
 * turned every chapter with a citation into an HTTP 500, while the 16th edition notes style
 * rendered. The 18th edition notes-only style has no `<bibliography>` element at all, and for
 * such a style citeproc's `makeBibliography()` answers `false` rather than an empty list;
 * `renderCitations` destructured it and threw "boolean false is not iterable".
 *
 * This renders the real style — `fixtures/chicago-notes.csl`, verbatim from the CSL repository at
 * the commit the catalogue pins (CC BY-SA 3.0, its own `<info>` says so) — through the same
 * `registerStyleXml` the API's style store uses for a fetched style.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { previewStyle } from '../src/preview.js';
import { declaresBibliography, renderCitations } from '../src/render.js';
import { findStyle, registerStyleXml } from '../src/styles.js';

const STYLE = 'chicago-notes';
const entry = findStyle(STYLE);
if (!entry) throw new Error(`${STYLE} is not in the catalogue`);
registerStyleXml(
  entry.xmlId ?? STYLE,
  readFileSync(new URL('./fixtures/chicago-notes.csl', import.meta.url), 'utf8'),
);

const KUMAR = {
  id: 's1',
  title: 'Drip irrigation in rural Karnataka',
  authors: [{ family: 'Kumar', given: 'Anil' }],
  year: 2021,
  venue: 'Water Policy',
};
const RAO = {
  id: 's2',
  title: 'Subsidy timing',
  authors: [{ family: 'Rao', given: 'Priya' }],
  year: 2019,
};

describe('a style with no bibliography (Chicago 18th, notes without bibliography)', () => {
  it('is known to have none', () => {
    expect(declaresBibliography(entry)).toBe(false);
    expect(declaresBibliography(findStyle('apa') as NonNullable<typeof entry>)).toBe(true);
  });

  it('renders its notes, and an empty bibliography rather than throwing', () => {
    const result = renderCitations({
      style: STYLE,
      sources: [KUMAR, RAO],
      citations: [
        { key: 'a', sourceId: 's1', noteIndex: 1 },
        { key: 'b', sourceId: 's1', noteIndex: 2 },
        { key: 'c', sourceId: 's2', noteIndex: 3 },
      ],
    });
    expect(result.style.id).toBe(STYLE);
    expect(result.noteStyle).toBe(true);
    expect(result.hasBibliography).toBe(false);
    expect(result.bibliography).toEqual([]);
    expect(result.labels.a).toContain('Anil Kumar');
    expect(result.labels.a).toContain('Drip Irrigation in Rural Karnataka');
    // The 18th edition drops "Ibid." for the short form; either way the note is not empty.
    expect(result.labels.b).toMatch(/Kumar|Ibid/);
    expect(result.labels.c).toContain('Priya Rao');
  });

  it('renders citations side by side as one note (ADR-0117)', () => {
    const result = renderCitations({
      style: STYLE,
      sources: [KUMAR, RAO],
      citations: [
        { key: 'a', sourceId: 's1', noteIndex: 1, run: 'ch1:0' },
        { key: 'b', sourceId: 's2', noteIndex: 1, run: 'ch1:0' },
      ],
    });
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]?.keys).toEqual(['a', 'b']);
    expect(result.clusters[0]?.label).toContain('Kumar');
    expect(result.clusters[0]?.label).toContain('Rao');
    expect(result.bibliography).toEqual([]);
  });

  it('previews, with no bibliography line to show', () => {
    const preview = previewStyle(STYLE);
    expect(preview.styleId).toBe(STYLE);
    expect(preview.noteStyle).toBe(true);
    expect(preview.inText).not.toBe('');
    expect(preview.bibliography).toBe('');
    expect(preview.hasBibliography).toBe(false);
  });

  it('leaves a style with a bibliography as it was', () => {
    const result = renderCitations({
      style: 'apa',
      sources: [KUMAR],
      citations: [{ key: 'a', sourceId: 's1' }],
    });
    expect(result.hasBibliography).toBe(true);
    expect(result.bibliography).toHaveLength(1);
  });
});
