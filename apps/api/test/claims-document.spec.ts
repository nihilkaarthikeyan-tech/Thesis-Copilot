/**
 * The claims map as a document — R38, ADR-0123. Pinned: six pending draft blocks in order, every
 * word `DRAFT` provenance on its section's action, the whole thing valid in the editor's schema;
 * every claim sentence cited, only from papers still in the library, at the passage the map read;
 * a claim with none of its papers left is left out and said so; directions and limits uncited.
 */

import type { MappedClaim } from '@tc/ai';
import { thesisExtensions } from '@tc/ui';
import { getSchema } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { citationsIn } from '../src/modules/chapters/citations.js';
import {
  claimsChapterDoc,
  claimsDocument,
  GAP_SECTIONS,
  type GapSection,
  type StoredClaimsMap,
  shortClaim,
} from '../src/modules/documents/claims-document.js';

const schema = getSchema(
  thesisExtensions({
    ghostText: {
      chapterId: 'test',
      request: () => {
        throw new Error('not in tests');
      },
    },
    resizableTables: false,
  }),
);

type Node = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  content?: Node[];
};

const claim = (over: Partial<MappedClaim> & Pick<MappedClaim, 'claim'>): MappedClaim => ({
  status: 'under-explored',
  supporting: [],
  contrasting: [],
  direction: '',
  limits: '',
  ...over,
});

const MAP: StoredClaimsMap = {
  computedAt: '2026-10-05T09:30:00.000Z',
  papers: [
    { id: 'p1', title: 'Household frictions', year: 2024, chunkId: 'k1' },
    { id: 'p2', title: 'Financing rural solar', year: 2023, chunkId: 'k2' },
    { id: 'p3', title: 'Subsidy delivery', year: 2025, chunkId: null },
    { id: 'p4', title: 'A paper since removed', year: 2022, chunkId: 'k4' },
  ],
  claims: [
    claim({
      claim: 'Upfront cost limits rooftop adoption among rural households.',
      status: 'well-supported',
      supporting: ['p1', 'p2', 'p3'],
      direction: 'Measure cost against credit access in Karnataka.',
      limits: 'Surveys before 2020 only.',
    }),
    claim({
      claim: 'Subsidies reach households late',
      status: 'contested',
      supporting: ['p3'],
      contrasting: ['p2', 'p4'],
      direction: 'Reconcile the delivery records with the surveys.',
      limits: 'Two districts.',
    }),
    claim({
      claim: 'Installer networks shape which villages adopt',
      status: 'under-explored',
      supporting: ['p1'],
    }),
    claim({
      claim: 'Only the removed paper said this',
      status: 'under-explored',
      supporting: ['p4'],
    }),
  ],
};

const AVAILABLE = new Map([
  ['p1', { chunkId: 'k1' }],
  ['p2', { chunkId: 'k2' }],
  ['p3', { chunkId: null }],
]);

const ACTIONS = Object.fromEntries(GAP_SECTIONS.map((s) => [s, `ev-${s}`])) as Record<
  GapSection,
  string
>;

function build(map = MAP, available = AVAILABLE) {
  let k = 0;
  let r = 0;
  return claimsDocument({
    map,
    available,
    actionIds: ACTIONS,
    newCitationKey: () => `c_test${++k}`,
    newRefId: () => `r_test${++r}`,
    paperChars: 900,
  });
}

const walk = (node: Node, visit: (n: Node) => void): void => {
  visit(node);
  for (const child of node.content ?? []) walk(child, visit);
};
const textOf = (node: Node): string => {
  let out = '';
  walk(node, (n) => {
    if (n.type === 'text') out += n.text ?? '';
    if (n.type === 'citation') out += `[${String(n.attrs?.sourceId)}]`;
  });
  return out;
};
const blockOf = (blocks: Node[], section: GapSection) =>
  blocks.find((b) => b.attrs?.draftId === ACTIONS[section]) as Node;

describe('claimsDocument', () => {
  it('is six pending draft blocks, in order, valid in the editor’s schema', () => {
    const built = build();
    const blocks = built.blocks as Node[];
    expect(blocks.map((b) => b.type)).toEqual(GAP_SECTIONS.map(() => 'draftBlock'));
    expect(blocks.map((b) => b.attrs)).toEqual(
      GAP_SECTIONS.map((s) => ({ draftId: ACTIONS[s], status: 'pending' })),
    );
    expect(blocks.map((b) => textOf(b.content?.[0] as Node))).toEqual([
      'Claims in the library',
      'Under-explored',
      'Contested',
      'Well supported',
      'Directions',
      'Limits of this mapping',
    ]);
    const doc = claimsChapterDoc('Research gap analysis', built.blocks);
    expect(() => schema.nodeFromJSON(doc).check()).not.toThrow();
  });

  it('marks every word DRAFT, on its own section’s action', () => {
    const built = build();
    for (const [i, block] of (built.blocks as Node[]).entries()) {
      let chars = 0;
      walk(block, (n) => {
        if (n.type !== 'text') return;
        chars += n.text?.length ?? 0;
        const provenance = n.marks?.find((m) => m.type === 'provenance');
        expect(provenance?.attrs).toEqual({
          kind: 'DRAFT',
          actionId: ACTIONS[GAP_SECTIONS[i] as GapSection],
        });
      });
      expect(built.shownChars[GAP_SECTIONS[i] as GapSection]).toBe(chars);
    }
  });

  it('cites every claim, only from papers still in the library, at the passage the map read', () => {
    const built = build();
    const doc = claimsChapterDoc('Research gap analysis', built.blocks);
    const rows = citationsIn(doc);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(['p1', 'p2', 'p3']).toContain(row.sourceId);
      expect(row.chunkId).toBe(AVAILABLE.get(row.sourceId)?.chunkId ?? null);
      expect(row.role).toBe('parenthetical');
    }
    expect(new Set(rows.map((r) => r.nodeKey)).size).toBe(rows.length);

    // Each kept claim's sentence carries its supporting papers.
    const sections = built.blocks as Node[];
    const well = textOf(blockOf(sections, 'well-supported'));
    expect(well).toContain(
      'Upfront cost limits rooftop adoption among rural households [p1][p2][p3].',
    );
    const contested = textOf(blockOf(sections, 'contested'));
    expect(contested).toContain('Subsidies reach households late [p3]. Contrasted by [p2].');
    const under = textOf(blockOf(sections, 'under-explored'));
    expect(under).toContain(
      'Installer networks shape which villages adopt [p1]. Supported here by one paper.',
    );
  });

  it('lists a "well supported" claim with fewer than three papers as under-explored', () => {
    // QA 2026-10-08: the section says "three or more papers agree"; it listed one two supported.
    const built = build({
      ...MAP,
      claims: [
        claim({
          claim: 'Two papers agree on this',
          status: 'well-supported',
          supporting: ['p1', 'p2'],
        }),
      ],
    });
    const blocks = built.blocks as Node[];
    expect(textOf(blockOf(blocks, 'well-supported'))).not.toContain('Two papers agree on this');
    expect(textOf(blockOf(blocks, 'under-explored'))).toContain(
      'Two papers agree on this [p1][p2]. Supported here by two papers.',
    );
  });

  it('leaves out a claim with none of its papers left, and says so', () => {
    const built = build();
    expect(built.claims).toBe(3);
    expect(built.leftOut).toBe(1);
    expect(built.missingPapers).toBe(1); // p4, named against the contested claim
    const all = (built.blocks as Node[]).map(textOf).join('\n');
    expect(all).not.toContain('Only the removed paper said this');
    expect(all).not.toContain('[p4]');
    const limits = textOf(blockOf(built.blocks as Node[], 'limits'));
    expect(limits).toContain(
      'One claim is left out: the papers it rested on are no longer in your library.',
    );
    expect(limits).toContain(
      'One paper the mapping named is no longer in your library and not cited here.',
    );
    expect(limits).toContain('at most 900 characters');
    expect(limits).toContain('5 October 2026');
  });

  it('puts the claims in a table: claim, status, evidence, direction', () => {
    const block = blockOf(build().blocks as Node[], 'claims');
    const summary = textOf(block.content?.[1] as Node);
    expect(summary).toContain('This mapping read four papers in your library on 5 October 2026');
    expect(summary).toContain('found three claims');
    expect(summary).toContain('one under-explored, one contested, one well supported');
    const table = block.content?.[2] as Node;
    expect(table.type).toBe('table');
    expect(table.attrs?.refId).toBe('r_test1');
    expect(String(table.attrs?.caption)).toMatch(/^Claims in the library/);
    const rows = table.content ?? [];
    expect(rows).toHaveLength(4);
    expect(rows[0]?.content?.map((c) => [c.type, textOf(c)])).toEqual([
      ['tableHeader', 'Claim'],
      ['tableHeader', 'Status'],
      ['tableHeader', 'Evidence'],
      ['tableHeader', 'Direction'],
    ]);
    // Under-explored first, then contested, then well supported.
    expect(rows.slice(1).map((r) => textOf(r.content?.[1] as Node))).toEqual([
      'Under-explored',
      'Contested',
      'Well supported',
    ]);
    expect(textOf(rows[2]?.content?.[2] as Node)).toBe('Supporting: [p3]. Contrasting: [p2].');
    expect(textOf(rows[1]?.content?.[2] as Node)).toBe(
      'Supporting: [p1]. Contrasting: none found.',
    );
    expect(textOf(rows[3]?.content?.[3] as Node)).toBe(
      'Measure cost against credit access in Karnataka.',
    );
    // A claim with no direction leaves its cell empty, not invented.
    expect(rows[1]?.content?.[3]?.content).toEqual([{ type: 'paragraph' }]);
  });

  it('cites nothing in the directions and the limits: they are suggestions, not the papers', () => {
    const blocks = build().blocks as Node[];
    for (const section of ['directions', 'limits'] as const) {
      let cites = 0;
      walk(blockOf(blocks, section), (n) => {
        if (n.type === 'citation') cites++;
      });
      expect(cites).toBe(0);
    }
    const directions = textOf(blockOf(blocks, 'directions'));
    expect(directions).toContain(
      'On “Upfront cost limits rooftop adoption among rural households”: Measure cost against credit access in Karnataka.',
    );
    expect(directions).not.toContain('Installer networks'); // no direction was given for it
  });

  it('says so when a status has no claims', () => {
    const only: StoredClaimsMap = { ...MAP, claims: [MAP.claims[0] as MappedClaim] };
    const blocks = build(only).blocks as Node[];
    expect(textOf(blockOf(blocks, 'under-explored'))).toContain(
      'The mapping marked no claim under-explored.',
    );
    expect(textOf(blockOf(blocks, 'contested'))).toContain(
      'The mapping marked no claim contested.',
    );
    const limits = textOf(blockOf(blocks, 'limits'));
    expect(limits).not.toContain('left out');
    expect(limits).not.toContain('no longer in your library');
  });

  it('builds nothing to cite when every paper is gone', () => {
    const built = build(MAP, new Map());
    expect(built.claims).toBe(0);
    expect(built.leftOut).toBe(4);
  });
});

describe('shortClaim', () => {
  it('keeps a short claim whole, without its full stop', () => {
    expect(shortClaim('Cost limits adoption.')).toBe('Cost limits adoption');
  });

  it('cuts a long one at a word, with an ellipsis', () => {
    const long =
      'Night-time urban heat islands prolong heat strain among outdoor workers well into the following shift';
    const short = shortClaim(long);
    expect(short.endsWith('…')).toBe(true);
    expect(short.length).toBeLessThanOrEqual(71);
    expect(long.startsWith(short.slice(0, -1))).toBe(true);
    expect(short).not.toMatch(/\s…$/);
  });
});
