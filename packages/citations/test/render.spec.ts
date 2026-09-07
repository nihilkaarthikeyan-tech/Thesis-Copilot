/**
 * Citation rendering — PRD FR-5.1, FR-5.2, §5.5; PHASES v2 W10 and the VERIFY batch
 * ("CSL golden strings for 5 styles").
 *
 * The strings below were produced by citeproc from the CSL files in `../styles` and pasted here.
 * They are golden in the strict sense: nobody wrote them by hand, and a change to any of them
 * means either a style file moved or `toCslItem` started mapping a field differently. Both are
 * worth stopping for — a student submits what this produces.
 *
 * The property that matters more than any single string is the last group: **the label a reader
 * sees must point at the bibliography entry it names.** That was a real bug, found in week 10 by
 * driving one citeproc engine per citation instead of one per document, and the numbers came out
 * in a different order from the list they indexed.
 */

import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderCitations } from '../src/render.js';
import { STYLES } from '../src/styles.js';

const STYLES_DIR = fileURLToPath(new URL('../styles/', import.meta.url));

const SOURCES = [
  {
    id: 's1',
    title: 'Solar drying of marine fish in coastal Tamil Nadu',
    authors: [
      { family: 'Kumar', given: 'A.' },
      { family: 'Raman', given: 'S.' },
    ],
    year: 2021,
    venue: 'Renewable Energy',
    doi: '10.1016/j.renene.2021.01.001',
  },
  {
    id: 's2',
    title: 'A forced-convection dryer for small landings',
    authors: [{ family: 'Bose', given: 'P.' }],
    year: 2019,
    venue: 'Solar Energy',
  },
  {
    id: 's3',
    title: 'Post-harvest losses in Indian fisheries',
    authors: [
      { family: 'Anand', given: 'R.' },
      { family: 'Iyer', given: 'M.' },
      { family: 'Das', given: 'K.' },
    ],
    year: 2018,
    venue: 'Food Policy',
  },
];

/** Document order: s2 first, then s1, then s3, then s1 again. */
const CITATIONS = [
  { key: 'k1', sourceId: 's2' },
  { key: 'k2', sourceId: 's1' },
  { key: 'k3', sourceId: 's3' },
  { key: 'k4', sourceId: 's1' },
];

const render = (style: string) =>
  renderCitations({ style, sources: SOURCES, citations: CITATIONS }, STYLES_DIR);

describe('the five styles a pilot department is most likely to ask for', () => {
  it('APA 7th', () => {
    const out = render('apa');
    expect(out.labels).toEqual({
      k1: '(Bose, 2019)',
      k2: '(Kumar & Raman, 2021)',
      k3: '(Anand et al., 2018)',
      k4: '(Kumar & Raman, 2021)',
    });
    expect(out.bibliography.map((b) => b.text)).toEqual([
      'Anand, R., Iyer, M., & Das, K. (2018). Post-harvest losses in Indian fisheries. Food Policy.',
      'Bose, P. (2019). A forced-convection dryer for small landings. Solar Energy.',
      'Kumar, A., & Raman, S. (2021). Solar drying of marine fish in coastal Tamil Nadu. Renewable Energy. https://doi.org/10.1016/j.renene.2021.01.001',
    ]);
  });

  it('IEEE', () => {
    const out = render('ieee');
    expect(out.labels).toEqual({ k1: '[1]', k2: '[2]', k3: '[3]', k4: '[2]' });
    expect(out.bibliography.map((b) => b.text)).toEqual([
      '[1] P. Bose, “A forced-convection dryer for small landings,” Solar Energy, 2019.',
      '[2] A. Kumar and S. Raman, “Solar drying of marine fish in coastal Tamil Nadu,” Renewable Energy, 2021, doi: 10.1016/j.renene.2021.01.001.',
      '[3] R. Anand, M. Iyer, and K. Das, “Post-harvest losses in Indian fisheries,” Food Policy, 2018.',
    ]);
  });

  it('Vancouver', () => {
    const out = render('vancouver');
    expect(out.labels).toEqual({ k1: '(1)', k2: '(2)', k3: '(3)', k4: '(2)' });
    expect(out.bibliography.map((b) => b.text)).toEqual([
      '1. Bose P. A forced-convection dryer for small landings. Solar Energy. 2019.',
      '2. Kumar A, Raman S. Solar drying of marine fish in coastal Tamil Nadu. Renewable Energy. 2021. doi:10.1016/j.renene.2021.01.001',
      '3. Anand R, Iyer M, Das K. Post-harvest losses in Indian fisheries. Food Policy. 2018.',
    ]);
  });

  it('Harvard (Cite Them Right)', () => {
    const out = render('harvard');
    expect(out.labels).toEqual({
      k1: '(Bose, 2019)',
      k2: '(Kumar and Raman, 2021)',
      k3: '(Anand, Iyer and Das, 2018)',
      k4: '(Kumar and Raman, 2021)',
    });
    // "[Preprint]" is this style's honest reading of a journal article with no volume, issue or
    // pages. Our fixture has none, because a `Source` resolved from a DOI often has none either.
    expect(out.bibliography[0]?.text).toBe(
      'Anand, R., Iyer, M. and Das, K. (2018) “Post-harvest losses in Indian fisheries,” Food Policy [Preprint].',
    );
    expect(out.bibliography.map((b) => b.sourceId)).toEqual(['s3', 's2', 's1']);
  });

  it('Chicago author-date', () => {
    const out = render('chicago-author-date');
    expect(out.labels).toEqual({
      k1: '(Bose 2019)',
      k2: '(Kumar and Raman 2021)',
      k3: '(Anand et al. 2018)',
      k4: '(Kumar and Raman 2021)',
    });
    expect(out.bibliography.map((b) => b.text)).toEqual([
      'Anand, R., M. Iyer, and K. Das. 2018. “Post-Harvest Losses in Indian Fisheries.” Food Policy.',
      'Bose, P. 2019. “A Forced-Convection Dryer for Small Landings.” Solar Energy.',
      'Kumar, A., and S. Raman. 2021. “Solar Drying of Marine Fish in Coastal Tamil Nadu.” Renewable Energy, ahead of print. https://doi.org/10.1016/j.renene.2021.01.001.',
    ]);
  });
});

describe('the properties that hold whatever the style', () => {
  it('numbers in first-citation order, and reuses the number for a repeat', () => {
    for (const style of ['ieee', 'vancouver', 'nature']) {
      const out = render(style);
      expect(out.labels.k2, style).toBe(out.labels.k4);
      const numberOf = (label: string) => Number(label.replace(/\D/g, ''));
      expect(numberOf(out.labels.k1 ?? ''), style).toBe(1);
      expect(numberOf(out.labels.k2 ?? ''), style).toBe(2);
      expect(numberOf(out.labels.k3 ?? ''), style).toBe(3);
    }
  });

  it('orders a numeric bibliography by citation order and an author-date one alphabetically', () => {
    expect(render('ieee').bibliography.map((b) => b.sourceId)).toEqual(['s2', 's1', 's3']);
    expect(render('apa').bibliography.map((b) => b.sourceId)).toEqual(['s3', 's2', 's1']);
  });

  it('a numeric label points at the entry that carries the same number', () => {
    // This is the week-10 bug, as a test. Driving citeproc per citation gave labels that indexed
    // a list they were not built from, so [2] in the text was a different paper from 2. in the
    // bibliography — invisible on screen and wrong in the submitted PDF.
    for (const style of ['ieee', 'vancouver', 'nature']) {
      const out = render(style);
      for (const citation of CITATIONS) {
        const n = Number((out.labels[citation.key] ?? '').replace(/\D/g, ''));
        expect(out.bibliography[n - 1]?.sourceId, `${style} ${citation.key}`).toBe(
          citation.sourceId,
        );
      }
    }
  });

  it('gives the same source the same label everywhere it is cited', () => {
    for (const entry of STYLES.slice(0, 8)) {
      const out = renderCitations(
        { style: entry.id, sources: SOURCES, citations: CITATIONS },
        STYLES_DIR,
      );
      expect(out.labels.k2, entry.id).toBe(out.labels.k4);
    }
  });

  it('lists a source once in the bibliography however often it is cited', () => {
    const out = render('apa');
    expect(out.bibliography).toHaveLength(SOURCES.length);
    expect(new Set(out.bibliography.map((b) => b.sourceId)).size).toBe(SOURCES.length);
  });

  it('every style in the registry renders without throwing', () => {
    for (const entry of STYLES) {
      expect(
        () =>
          renderCitations({ style: entry.id, sources: SOURCES, citations: CITATIONS }, STYLES_DIR),
        entry.id,
      ).not.toThrow();
    }
  });
});

describe('what happens when the data is incomplete', () => {
  it('names a cited source that is not in the library rather than rendering a blank', () => {
    const out = renderCitations(
      {
        style: 'apa',
        sources: SOURCES,
        citations: [...CITATIONS, { key: 'k9', sourceId: 'gone' }],
      },
      STYLES_DIR,
    );
    expect(out.missingSourceIds).toEqual(['gone']);
    expect(out.bibliography.map((b) => b.sourceId)).not.toContain('gone');
  });

  it('renders a source with no author or year without inventing either', () => {
    const out = renderCitations(
      {
        style: 'apa',
        sources: [{ id: 'x', title: 'An untitled working paper', venue: 'Somewhere' }],
        citations: [{ key: 'k', sourceId: 'x' }],
      },
      STYLES_DIR,
    );
    const text = out.bibliography[0]?.text ?? '';
    expect(text).toContain('An untitled working paper');
    expect(text).not.toMatch(/\b(19|20)\d{2}\b/);
  });

  it('falls back to a known style rather than throwing on an unknown one', () => {
    const out = renderCitations(
      { style: 'not-a-style', sources: SOURCES, citations: CITATIONS },
      STYLES_DIR,
    );
    expect(STYLES.map((s) => s.id)).toContain(out.style.id);
    expect(out.bibliography).toHaveLength(3);
  });

  it('renders an empty document without a bibliography', () => {
    const out = renderCitations({ style: 'apa', sources: [], citations: [] }, STYLES_DIR);
    expect(out.bibliography).toEqual([]);
    expect(out.labels).toEqual({});
    expect(out.missingSourceIds).toEqual([]);
  });
});
