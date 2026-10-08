/**
 * R40 (ADR-0117): citations side by side print as one citation in every export.
 *
 * The `.docx` of 2026-10-07 read "(Gadekar et al., 2026)(Raja et al., 2026)". The renderer now
 * returns such a run as a cluster — its keys and the one label citeproc made of them — and each
 * exporter prints that label once, where the first node is, and nothing where the others are.
 * Every test opens the file it built and reads what a reader would see.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CitationMode } from '@tc/types';
import { readTemplateSpec, readThesisDetails } from '@tc/types';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { printCitation } from '../src/clusters.js';
import { chapterToDocx } from '../src/docx.js';
import { thesisToHtml } from '../src/html.js';
import { thesisToLatexFiles } from '../src/latex.js';
import { thesisToDocx } from '../src/thesis.js';

const SPEC = readTemplateSpec(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../db/prisma/seed-data/example-template.json', import.meta.url)),
      'utf8',
    ),
  ),
);

const SOURCES = [
  {
    id: 's-kumar',
    title: 'Soil carbon and yield',
    year: 2021,
    cslJson: {
      type: 'article-journal',
      title: 'Soil carbon and yield',
      author: [{ family: 'Kumar', given: 'Anil' }],
      issued: { 'date-parts': [[2021]] },
    },
  },
  {
    id: 's-rao',
    title: 'Irrigation report',
    year: 2019,
    cslJson: {
      type: 'report',
      title: 'Irrigation report',
      author: [{ family: 'Rao', given: 'Meera' }],
      issued: { 'date-parts': [[2019]] },
    },
  },
];

const cite = (key: string, sourceId: string, extra: Record<string, string> = {}) => ({
  type: 'citation',
  attrs: { key, sourceId, role: 'parenthetical', ...extra },
});

/** "…rose (Kumar; Rao). …fell (Rao)." — a cluster of two, then a citation on its own. */
const CONTENT = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Results' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Yields rose ' },
        cite('n1', 's-kumar', { locator: '52' }),
        cite('n2', 's-rao'),
        { type: 'text', text: '. Water use fell ' },
        cite('n3', 's-rao'),
        { type: 'text', text: '.' },
      ],
    },
  ],
};

/** As `renderCitations` returns them: each node's own label, and the run as one. */
const LABELS = {
  n1: '(Kumar, 2021, p. 52)',
  n2: '(Rao, 2019)',
  n3: '(Rao, 2019)',
};
const CLUSTERS = [{ keys: ['n1', 'n2'], label: '(Kumar, 2021, p. 52; Rao, 2019)' }];
const NOTES = {
  n1: 'Anil Kumar, Soil carbon and yield (2021), 52.',
  n2: 'Meera Rao, Irrigation report (2019).',
  n3: 'Rao, Irrigation report.',
};
const NOTE_CLUSTERS = [
  {
    keys: ['n1', 'n2'],
    label: 'Anil Kumar, Soil carbon and yield (2021), 52; Meera Rao, Irrigation report (2019).',
  },
];
const ENTRY_SOURCES = ['s-kumar', 's-rao'];
const BIBLIOGRAPHY = [
  'Kumar, A. (2021). Soil carbon and yield.',
  'Rao, M. (2019). Irrigation report.',
];

const decodeXml = (text: string) =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/** What a reader sees: every `w:t`, with field instructions (never displayed) left out. */
const visibleText = (xml: string) =>
  decodeXml(
    [
      ...xml
        .replace(/<w:instrText\b[^>]*>.*?<\/w:instrText>/g, '')
        .matchAll(/<w:t\b[^>]*>(.*?)<\/w:t>/g),
    ]
      .map((m) => m[1])
      .join(''),
  );

async function read(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const file = async (path: string) => (await zip.file(path)?.async('string')) ?? '';
  return { document: await file('word/document.xml'), footnotes: await file('word/footnotes.xml') };
}

async function thesis(
  mode: CitationMode,
  renderedMap: Record<string, string> = LABELS,
  clusters = CLUSTERS,
  noteStyle = false,
) {
  return read(
    await thesisToDocx({
      spec: SPEC,
      details: readThesisDetails({}),
      documentTitle: 'A thesis',
      chapters: [
        {
          id: 'c1',
          title: 'Results',
          order: 1,
          content: CONTENT,
          renderedMap,
          citationClusters: clusters,
        },
      ],
      bibliography: BIBLIOGRAPHY,
      noteStyle,
      citationLinks: { mode, entrySources: ENTRY_SOURCES, sources: SOURCES },
    }),
  );
}

describe('what a citation node prints', () => {
  const nodes = CONTENT.content[1]?.content ?? [];

  it('a cluster once, at its first node, and nothing at the others', () => {
    expect(printCitation(nodes, 1, LABELS, CLUSTERS)).toMatchObject({
      kind: 'print',
      label: CLUSTERS[0]?.label,
      cluster: true,
    });
    expect(printCitation(nodes, 2, LABELS, CLUSTERS)).toEqual({ kind: 'skip' });
    expect(printCitation(nodes, 4, LABELS, CLUSTERS)).toMatchObject({ label: LABELS.n3 });
  });

  it('each node its own label when the nodes are no longer side by side', () => {
    const apart = [nodes[1], { type: 'text', text: ' ' }, nodes[2]] as typeof nodes;
    expect(printCitation(apart, 0, LABELS, CLUSTERS)).toMatchObject({ label: LABELS.n1 });
    expect(printCitation(apart, 2, LABELS, CLUSTERS)).toMatchObject({ label: LABELS.n2 });
  });
});

describe('the .docx', () => {
  it('prints one bracket, before the full stop, and never the two labels side by side', async () => {
    for (const buffer of [
      await chapterToDocx(CONTENT, {
        title: 'Results',
        renderedMap: LABELS,
        citationClusters: CLUSTERS,
      }),
    ]) {
      const text = visibleText((await read(buffer)).document);
      expect(text).toContain(
        'Yields rose (Kumar, 2021, p. 52; Rao, 2019). Water use fell (Rao, 2019).',
      );
      expect(text).not.toContain(')(');
    }
    const whole = visibleText((await thesis('plain')).document);
    expect(whole).toContain(
      'Yields rose (Kumar, 2021, p. 52; Rao, 2019). Water use fell (Rao, 2019).',
    );
  });

  it('prints each node as before when there are no clusters', async () => {
    const buffer = await chapterToDocx(CONTENT, { title: 'Results', renderedMap: LABELS });
    expect(visibleText((await read(buffer)).document)).toContain(
      'Yields rose (Kumar, 2021, p. 52)(Rao, 2019).',
    );
  });

  it('linked: the one label links to its first source’s entry', async () => {
    const { document } = await thesis('linked');
    const links = [
      ...document.matchAll(/<w:hyperlink\b[^>]*w:anchor="([^"]+)"[^>]*>(.*?)<\/w:hyperlink>/g),
    ].map((m) => ({ anchor: m[1], text: visibleText(m[2] ?? '') }));
    expect(links).toEqual([
      { anchor: 'tc_ref_1', text: CLUSTERS[0]?.label },
      { anchor: 'tc_ref_2', text: LABELS.n3 },
    ]);
  });

  it('Word citations: one CITATION field with every source, its page after its own tag', async () => {
    const { document } = await thesis('word');
    const fields = [...document.matchAll(/<w:fldSimple w:instr="([^"]*)">(.*?)<\/w:fldSimple>/g)];
    expect(fields.map((m) => decodeXml(m[1] ?? ''))).toEqual([
      ' CITATION Kumar2021Soil \\p "52" \\m Rao2019Irrigation ',
      ' CITATION Rao2019Irrigation ',
    ]);
    expect(fields.map((m) => visibleText(m[2] ?? ''))).toEqual([CLUSTERS[0]?.label, LABELS.n3]);
  });

  it('a note style: the cluster is one footnote holding the one note', async () => {
    const { document, footnotes } = await thesis('plain', NOTES, NOTE_CLUSTERS, true);
    expect(document.match(/<w:footnoteReference w:id="\d+"\/>/g)).toHaveLength(2);
    // The two notes and nothing else: Kumar's and Rao's own notes are not written beside them.
    expect(visibleText(footnotes)).toContain(`${NOTE_CLUSTERS[0]?.label}${NOTES.n3}`);
    expect(visibleText(footnotes)).not.toContain(NOTES.n1);
  });
});

describe('the HTML page and the LaTeX project', () => {
  const chapter = {
    id: 'c1',
    title: 'Results',
    order: 1,
    content: CONTENT,
    renderedMap: LABELS,
    citationClusters: CLUSTERS,
  };

  it('HTML: one citation, linked to its first source', () => {
    const html = thesisToHtml({
      spec: SPEC,
      details: readThesisDetails({}),
      documentTitle: 'A thesis',
      chapters: [chapter],
      bibliography: ENTRY_SOURCES.map((sourceId, i) => ({ sourceId, text: BIBLIOGRAPHY[i] ?? '' })),
      citeSources: { n1: 's-kumar', n2: 's-rao', n3: 's-rao' },
      exportedOn: '2026-10-08',
    });
    expect(html).toContain(
      'Yields rose <a class="citation" href="#ref-s-kumar">(Kumar, 2021, p. 52; Rao, 2019)</a>. Water',
    );
    expect(html.match(/class="citation"/g)).toHaveLength(2);
  });

  const latex = (locators: Record<string, string>, bibStyle: 'authoryear' | 'verbose-ibid') =>
    String(
      thesisToLatexFiles({
        spec: SPEC,
        details: readThesisDetails({}),
        documentTitle: 'A thesis',
        chapters: [chapter],
        bibliography: [],
        citeKeys: { n1: 'kumar2021', n2: 'rao2019', n3: 'rao2019' },
        locators,
        bibtex: '',
        bibStyle,
        styleLabel: 'APA 7th edition',
        exportedOn: '2026-10-08',
      }).find((f) => f.path === 'main.tex')?.data,
    );

  it('LaTeX: one command with both keys, so biblatex prints one bracket', () => {
    expect(latex({}, 'authoryear')).toContain('Yields rose \\parencite{kumar2021,rao2019}. Water');
    expect(latex({ n1: '52' }, 'authoryear')).toContain(
      'Yields rose \\parencites[52]{kumar2021}{rao2019}. Water',
    );
    expect(latex({}, 'verbose-ibid')).toContain('Yields rose \\footcite{kumar2021,rao2019}.');
  });
});
