/**
 * R40 (ADR-0117): citations side by side are one citation.
 *
 * The browser run of 2026-10-07 read "(Gadekar et al., 2026)(Raja et al., 2026)": two citation
 * nodes, two brackets, no space. The walker now says which citations sit side by side (`run`),
 * and the renderer hands each run to citeproc as one citation with several cites, so the style
 * itself decides the order, the delimiter and the collapsing — APA's "; ", IEEE's "[2], [3]",
 * Vancouver's "(1–3)". Nothing is string-joined.
 *
 * As in `render.spec.ts`, every expected label below was produced by citeproc from the CSL files
 * in `../styles` and pasted here; none was written by hand.
 */

import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { citationNodesIn, notesIn } from '../src/checks.js';
import { type CitationRef, clusterPlaces, renderCitations } from '../src/render.js';
import { findStyle, registerStyleXml } from '../src/styles.js';

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

const cite = (key: string, sourceId: string, more: Partial<CitationRef> = {}): CitationRef => ({
  key,
  sourceId,
  ...more,
});

const render = (style: string, citations: CitationRef[]) =>
  renderCitations({ style, sources: SOURCES, citations }, STYLES_DIR);

/** One paragraph: Bose alone, then Kumar and Anand side by side, then text, then all three. */
const chapter = {
  id: 'ch1',
  title: 'Results',
  content: {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Dryers help ' },
          { type: 'citation', attrs: { key: 'k1', sourceId: 's2' } },
          { type: 'text', text: '. Losses fall ' },
          { type: 'citation', attrs: { key: 'k2', sourceId: 's1' } },
          { type: 'citation', attrs: { key: 'k3', sourceId: 's3' } },
          { type: 'text', text: '. Both ' },
          { type: 'citation', attrs: { key: 'k4', sourceId: 's2' } },
          { type: 'citation', attrs: { key: 'k5', sourceId: 's3' } },
          { type: 'citation', attrs: { key: 'k6', sourceId: 's1' } },
          { type: 'text', text: ' and ' },
          { type: 'citation', attrs: { key: 'k7', sourceId: 's2' } },
          { type: 'text', text: ' ' },
          { type: 'citation', attrs: { key: 'k8', sourceId: 's1' } },
        ],
      },
      {
        type: 'paragraph',
        content: [{ type: 'citation', attrs: { key: 'k9', sourceId: 's3' } }],
      },
    ],
  },
};

const walked = (): CitationRef[] =>
  citationNodesIn(chapter).map((node) => ({
    key: node.nodeKey,
    sourceId: node.sourceId,
    run: node.run,
    noteIndex: node.noteOrdinal,
  }));

describe('the walker says which citations sit side by side', () => {
  it('gives citations with nothing between them one run, and anything between ends it', () => {
    const runs = citationNodesIn(chapter).map((node) => node.run);
    // k2 k3 share a run, k4 k5 k6 share one; text — even a single space — separates k7 and k8.
    expect(runs[1]).toBe(runs[2]);
    expect(runs[3]).toBe(runs[4]);
    expect(runs[4]).toBe(runs[5]);
    expect(new Set(runs).size).toBe(6);
    // Unique through the thesis: the chapter id is part of it.
    expect(runs.every((run) => run.startsWith('ch1#'))).toBe(true);
  });

  it('counts a run as one note, which is what a note style makes of it', () => {
    expect(citationNodesIn(chapter).map((node) => node.noteOrdinal)).toEqual([
      1, 2, 2, 3, 3, 3, 4, 5, 6,
    ]);
    expect(notesIn(chapter)).toBe(6);
  });
});

describe('a run renders as one citation, in the style’s own form', () => {
  it('APA: one bracket, sorted and separated by the style', () => {
    const out = render('apa', walked());
    expect(out.clusters).toEqual([
      { keys: ['k2', 'k3'], label: '(Anand et al., 2018; Kumar & Raman, 2021)' },
      {
        keys: ['k4', 'k5', 'k6'],
        label: '(Anand et al., 2018; Bose, 2019; Kumar & Raman, 2021)',
      },
    ]);
    // A citation alone keeps its own label; a space between two keeps them two citations.
    expect(out.labels.k1).toBe('(Bose, 2019)');
    expect(out.labels.k7).toBe('(Bose, 2019)');
    expect(out.labels.k8).toBe('(Kumar & Raman, 2021)');
    // Each clustered citation still has the label it would show alone (the editor's fallback).
    expect(out.labels.k2).toBe('(Kumar & Raman, 2021)');
    expect(out.labels.k3).toBe('(Anand et al., 2018)');
  });

  it('IEEE numbers in reading order and joins them its own way', () => {
    const out = render('ieee', walked());
    expect(out.clusters.map((c) => c.label)).toEqual(['[2], [3]', '[1], [2], [3]']);
    expect(out.labels.k1).toBe('[1]');
    // The bibliography is in the order the numbers were given.
    expect(out.bibliography.map((b) => b.sourceId)).toEqual(['s2', 's1', 's3']);
  });

  it('Vancouver collapses a range', () => {
    const out = render('vancouver', walked());
    expect(out.clusters.map((c) => c.label)).toEqual(['(2,3)', '(1–3)']);
  });

  it('Chicago author-date keeps the order the student wrote', () => {
    const out = render('chicago-author-date', walked());
    expect(out.clusters[0]?.label).toBe('(Kumar and Raman 2021; Anand et al. 2018)');
  });

  it('renders exactly as before when no citation has a neighbour', () => {
    const alone = walked().map(({ run: _run, ...rest }) => rest);
    const before = render('apa', alone);
    expect(before.clusters).toEqual([]);
    expect(before.labels.k2).toBe('(Kumar & Raman, 2021)');
    expect(Object.keys(before.labels)).toHaveLength(9);
  });
});

describe('the faults a cluster must not bring', () => {
  it('prints the same paper twice in one bracket once, with both pages', () => {
    const twice = render('apa', [
      cite('a', 's1', { run: 'r' }),
      cite('b', 's1', { run: 'r' }),
      cite('c', 's1', { run: 'q', locator: '3' }),
      cite('d', 's1', { run: 'q', locator: '7' }),
    ]);
    expect(twice.clusters.map((c) => c.label)).toEqual([
      '(Kumar & Raman, 2021)',
      '(Kumar & Raman, 2021, pp. 3, 7)',
    ]);
    const numbered = render('vancouver', [
      cite('a', 's1', { run: 'r' }),
      cite('b', 's1', { run: 'r', locator: '7' }),
    ]);
    expect(numbered.clusters.map((c) => c.label)).toEqual(['(1)']);
  });

  it('keeps a narrative citation out of a bracket: it is part of the sentence', () => {
    const out = render('apa', [
      cite('a', 's1', { run: 'r', role: 'narrative' }),
      cite('b', 's2', { run: 'r' }),
      cite('c', 's3', { run: 'r' }),
    ]);
    expect(out.labels.a).toBe('Kumar & Raman (2021)');
    expect(out.clusters).toEqual([{ keys: ['b', 'c'], label: '(Anand et al., 2018; Bose, 2019)' }]);
  });

  it('leaves a citation whose source is gone on its own, and does not join across it', () => {
    const out = render('apa', [
      cite('a', 's1', { run: 'r' }),
      cite('gone', 'deleted', { run: 'r' }),
      cite('b', 's2', { run: 'r' }),
    ]);
    expect(out.clusters).toEqual([]);
    expect(out.missingSourceIds).toEqual(['deleted']);
    expect(out.labels).toEqual({ a: '(Kumar & Raman, 2021)', b: '(Bose, 2019)' });
  });

  it('never puts one key in two clusters, or a cluster key in the single labels map alone', () => {
    const out = render('apa', walked());
    const places = clusterPlaces(out.clusters);
    expect([...places.keys()]).toEqual(['k2', 'k3', 'k4', 'k5', 'k6']);
    expect(places.get('k2')?.first).toBe(true);
    expect(places.get('k3')?.first).toBe(false);
  });
});

describe('a note style: a run is one footnote', () => {
  // A minimal note-class style written for the test, as in `note-styles.spec.ts`, with the
  // "; " a real notes style puts between the cites of one note.
  const NOTES = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="note" version="1.0" default-locale="en-US">
  <info>
    <title>Test notes with clusters</title>
    <id>http://example.invalid/test-notes-clusters</id>
    <updated>2026-10-08T00:00:00+00:00</updated>
  </info>
  <citation>
    <layout suffix="." delimiter="; ">
      <choose>
        <if position="ibid"><text value="Ibid"/></if>
        <else-if position="subsequent">
          <names variable="author"><name form="short"/></names>
        </else-if>
        <else>
          <names variable="author"><name/></names>
          <text variable="title" prefix=", "/>
        </else>
      </choose>
    </layout>
  </citation>
  <bibliography>
    <layout>
      <names variable="author"><name name-as-sort-order="first"/></names>
      <text variable="title" prefix=". "/>
    </layout>
  </bibliography>
</style>`;
  const STYLE = 'chicago-notes-bibliography-16th-edition';
  const entry = findStyle(STYLE);
  if (!entry) throw new Error(`${STYLE} is not in the catalogue`);
  registerStyleXml(entry.xmlId ?? STYLE, NOTES);

  it('writes the run as one note, and the next note knows it was not a single source', () => {
    const out = renderCitations({
      style: STYLE,
      sources: SOURCES,
      citations: [
        cite('a', 's1', { run: 'r', noteIndex: 1 }),
        cite('b', 's2', { run: 'r', noteIndex: 1 }),
        cite('c', 's2', { run: 'q', noteIndex: 2 }),
        cite('d', 's2', { run: 'p', noteIndex: 3 }),
      ],
    });
    expect(out.noteStyle).toBe(true);
    expect(out.clusters).toEqual([
      {
        keys: ['a', 'b'],
        label:
          'A. Kumar, S. Raman, Solar drying of marine fish in coastal Tamil Nadu; P. Bose, A forced-convection dryer for small landings.',
      },
    ]);
    // Note 2 follows a note of two sources, so it is not "Ibid."; note 3 follows note 2.
    expect(out.labels.c).toBe('Bose.');
    expect(out.labels.d).toBe('Ibid.');
  });
});
