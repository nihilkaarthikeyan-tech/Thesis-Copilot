/**
 * `chapter-build` — ADR-0039, driven end to end on the mock provider with a fake database.
 *
 * What is pinned: the build plans from the blueprint and delivers every written section as a
 * pending draft block with DRAFT provenance (nothing becomes thesis text); the pitfall bank fires
 * on the specification's own sentence and the one fix loop clears it; every call is logged under
 * CHAPTER_BUILD; the chapter is snapshotted before it is written; and a build that can write
 * nothing is REFUSED and gives its unit back.
 */

import {
  MockLlmProvider,
  mockDraftFor,
  mockEntitiesFor,
  mockExaminerFor,
  mockFixFor,
  mockProofreadResponse,
} from '@tc/ai';
import { PITFALL_SEED } from '@tc/config';
import type { ChapterBuildReport } from '@tc/types';
import { describe, expect, it, vi } from 'vitest';
import {
  type BuildCallLog,
  type ChapterBuildDeps,
  chapterRoleOf,
  planSections,
  runChapterBuild,
} from '../src/jobs/chapter-build.js';

const PASSAGE_TEXT =
  'Statistically loaded specimens of the AA7050 composite were tested for stress corrosion cracking in a 3.5% NaCl solution and the crack growth rate was recorded.';

/** Fourteen unrelated findings, one per section, so nothing is a near-duplicate of anything. */
const DISTINCT = [
  'Stir casting at 750 degrees with a four-blade impeller gave uniform particle distribution across the billet.',
  'Titanium carbide particles of ten micrometres raised the hardness of the matrix by forty percent in every batch.',
  'Graphite additions above five weight percent lowered the coefficient of friction in dry sliding against steel.',
  'Pin-on-disc wear testing under ASTM G99 at twenty newtons showed a transition from adhesive to abrasive wear.',
  'Aerospace fasteners made from high-strength aluminium alloys fail by pitting before they fail by fatigue.',
  'Finite element models of the crack tip predicted the measured growth rate within fifteen percent.',
  'Sodium chloride solutions at three and a half percent reproduce marine exposure in laboratory testing.',
  'Squeeze casting under one hundred megapascals closed the porosity that stir casting left behind.',
  'Hybrid reinforcement with a hard ceramic and a soft lubricant phase balanced strength against machinability.',
  'Wire electrical discharge machining cut the composite specimens without the tool wear that milling caused.',
  'Scanning electron microscopy of fracture surfaces showed particle pull-out at the weakest interfaces.',
  'The response surface method needed twenty runs to fit a second-order model of hardness against three factors.',
  'Thermal ageing at one hundred and twenty degrees for twenty-four hours recovered the strength lost in casting.',
  'Corrosion current density measured by potentiodynamic polarisation fell as the graphite content rose.',
];

function fakeWorld(options: { passages?: boolean } = {}) {
  const chapter = {
    id: 'ch-1',
    documentId: 'doc-1',
    outlineNodeId: 'ch1-introduction',
    title: 'Introduction',
    order: 0,
    scopeNote: 'Introduce the work.',
    content: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Introduction' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'The student wrote this line.' }] },
      ],
    },
    version: 3,
  };
  const build: Record<string, unknown> = {
    id: 'build-1',
    status: 'QUEUED',
    documentId: 'doc-1',
    chapterId: 'ch-1',
    userId: 'user-1',
  };
  const snapshots: unknown[] = [];
  const logged: BuildCallLog[] = [];
  const refunds: string[] = [];
  const events: unknown[] = [];
  const pitfallHits = new Map<string, number>();
  let retrievals = 0;

  const prisma = {
    chapterBuild: {
      findUnique: vi.fn(async () => ({ ...build })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(build, data);
        return build;
      }),
    },
    document: {
      findFirst: vi.fn(async () => ({
        id: 'doc-1',
        title: 'Stress corrosion cracking of AA7050 hybrid composites',
        field: 'Mechanical Engineering',
        language: 'en',
        template: 'STEM_EMPIRICAL',
        meta: {
          thesisDetails: { degree: 'PhD', abbreviations: { SCC: 'stress corrosion cracking' } },
        },
      })),
    },
    documentMemory: {
      findUnique: vi.fn(async () => ({
        scope: {
          workingTitle: 'Stress corrosion cracking of AA7050 hybrid composites',
          problemStatement: 'p',
          objectives: [
            'To fabricate AA7050/TiC/graphite hybrid composites by stir casting.',
            'To evaluate the SSCC resistance of the composites in a NaCl solution.',
          ],
          whyOpen: 'w',
        },
        outline: [
          {
            id: 'ch1-introduction',
            title: 'Introduction',
            scopeNote: 'Introduce the work.',
            children: [],
          },
          {
            id: 'ch2-literature',
            title: 'Literature Review',
            scopeNote: 'Review the field.',
            children: [],
          },
        ],
        glossary: {},
      })),
    },
    chapter: {
      findFirst: vi.fn(async () => ({ ...chapter })),
      findUnique: vi.fn(async () => ({ content: chapter.content, version: chapter.version })),
      updateMany: vi.fn(
        async ({ where, data }: { where: { version: number }; data: Record<string, unknown> }) => {
          if (where.version !== chapter.version) return { count: 0 };
          chapter.content = data.content as typeof chapter.content;
          chapter.version += 1;
          return { count: 1 };
        },
      ),
      update: vi.fn(async () => chapter),
    },
    pitfall: {
      findMany: vi.fn(async () =>
        PITFALL_SEED.map((p) => ({
          code: p.code,
          pattern: p.pattern ?? null,
          wrongPattern: p.wrongPattern,
          correctStatement: p.correctStatement,
          severity: p.severity,
        })),
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { code: string };
          data: { hits: { increment: number } };
        }) => {
          pitfallHits.set(where.code, (pitfallHits.get(where.code) ?? 0) + data.hits.increment);
          return {};
        },
      ),
    },
    source: {
      findMany: vi.fn(async () => [
        {
          id: 'src-1',
          title: 'SCC of aluminium composites',
          authors: [{ family: 'Kumar', given: 'A' }],
          year: 2021,
          doi: '10.1000/x',
          status: 'RESOLVED',
          groundingLevel: 'FULL_TEXT',
        },
      ]),
    },
    suggestionEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        events.push(data);
        return { id: `draft-${events.length}` };
      }),
    },
  };

  const llm = new MockLlmProvider({
    defaultText: (req) => (req.action === 'DRAFT' ? mockDraftFor(req) : mockFixFor(req)),
    responses: [
      {
        match: (req) => req.messages.some((m) => m.content.startsWith('<entity_types>')),
        respond: mockEntitiesFor,
      },
      {
        match: (req) => req.messages.some((m) => m.content.startsWith('<review')),
        respond: mockExaminerFor,
      },
      mockProofreadResponse,
    ],
  });

  const deps: ChapterBuildDeps = {
    prisma: prisma as unknown as ChapterBuildDeps['prisma'],
    llm,
    embeddings: {
      dims: 4,
      modelId: 'mock-embed',
      embed: vi.fn(async () => [[0, 0, 0, 0]]),
      embedWithUsage: vi.fn(async () => ({ vectors: [[0, 0, 0, 0]], tokens: 0 })),
    },
    memoryBlock: vi.fn(async () => '<document_memory></document_memory>'),
    retrieve: vi.fn(async () => {
      if (options.passages === false) return { passages: [], byKey: new Map() };
      const n = retrievals++;
      const text = n === 0 ? PASSAGE_TEXT : (DISTINCT[n % DISTINCT.length] as string);
      return {
        passages: [
          {
            id: 'S1#c1',
            shortRef: 'Kumar 2021',
            page: 3,
            text,
            sourceId: 'src-1',
            chunkId: 'chunk-1',
          },
        ],
        byKey: new Map([
          ['S1#c1', { sourceId: 'src-1', chunkId: 'chunk-1', shortRef: 'Kumar 2021' }],
        ]),
      };
    }),
    snapshot: vi.fn(async (input) => {
      snapshots.push(input);
    }),
    logCall: vi.fn(async (call: BuildCallLog) => {
      logged.push(call);
      return 1_000;
    }),
    refund: vi.fn(async (userId: string) => {
      refunds.push(userId);
    }),
  };

  return { deps, build, chapter, snapshots, logged, refunds, events, pitfallHits, llm };
}

const job = {
  buildId: 'build-1',
  documentId: 'doc-1',
  chapterId: 'ch-1',
  userId: 'user-1',
  profile: {
    disciplineId: 'engineering_core_v1',
    paradigm: 'experimental',
    universityId: 'generic_author_year_v1',
  },
};

describe('runChapterBuild', () => {
  it('plans, writes, checks, fixes and delivers every section as a pending draft block', async () => {
    const world = fakeWorld();
    const result = await runChapterBuild(job, world.deps);

    expect(result.status).toBe('DONE');
    expect(world.build.status).toBe('DONE');
    expect(result.drafted).toBeGreaterThanOrEqual(8);

    // Delivered as draft blocks the student must accept; nothing became plain thesis text.
    const blocks = (
      world.chapter.content as {
        content: Array<{ type: string; attrs?: { status?: string }; content?: unknown[] }>;
      }
    ).content;
    const drafts = blocks.filter((b) => b.type === 'draftBlock');
    expect(drafts.length).toBe(result.drafted);
    expect(drafts.every((d) => d.attrs?.status === 'pending')).toBe(true);
    expect(blocks[1]).toMatchObject({ type: 'paragraph' }); // the student's own line is untouched
    const texts = JSON.stringify(drafts);
    expect(texts).toContain('"kind":"DRAFT"');
    expect(texts).toContain('"type":"citation"');
    // Snapshotted before it was written, and the version moved on.
    expect(world.snapshots).toHaveLength(1);
    expect(world.chapter.version).toBe(4);
    // One SuggestionEvent per delivered section, so Accept in the editor finds its id.
    expect(world.events).toHaveLength(result.drafted);
    expect(world.events.every((e) => (e as { action: string }).action === 'CHAPTER_BUILD')).toBe(
      true,
    );

    // Every call logged: one entity extraction, one draft and one examiner pass per section, plus fixes.
    expect(world.logged.every((c) => c.ok)).toBe(true);
    // One entity extraction, then one proofread batch per delivered section (L6).
    expect(world.logged.filter((c) => c.tier === 'fast')).toHaveLength(1 + result.drafted);
    expect(world.logged.filter((c) => c.tier === 'strong').length).toBeGreaterThanOrEqual(
      2 * result.drafted,
    );

    const report = world.build.report as ChapterBuildReport;
    expect(report.sections.length).toBe(result.sections);
    expect(report.checks.find((c) => c.checkId === 'T2')?.status).toBeDefined();
    expect(report.references[0]).toMatchObject({
      sourceId: 'src-1',
      status: 'RESOLVED',
      grounding: 'FULL_TEXT',
    });
    expect(report.totals.spentInr).toBeGreaterThan(0);
    expect(report.disclosure).toContain('AI writing assistant');

    // The specification's "statistically loaded" reached the draft from the passage, the pitfall
    // bank caught it (T2, ENG-SCC-001), the fix loop rewrote it, and the hit was counted.
    const scc = report.issues.filter((i) => i.pitfallCode === 'ENG-SCC-001');
    expect(scc.length).toBeGreaterThan(0);
    expect(scc.every((i) => i.status === 'fixed')).toBe(true);
    expect(world.pitfallHits.get('ENG-SCC-001')).toBeGreaterThan(0);
    expect(JSON.stringify(world.chapter.content)).not.toContain('Statistically loaded');
    expect(world.refunds).toHaveLength(0);
    // Every model call carries a time limit (the second real build hung for hours without one).
    expect(world.llm.calls.every((c) => c.signal instanceof AbortSignal)).toBe(true);
  });

  it('is REFUSED, and gives the unit back, when no section can be written', async () => {
    const world = fakeWorld({ passages: false });
    const result = await runChapterBuild(job, world.deps);
    expect(result.status).toBe('REFUSED');
    expect(world.build.status).toBe('REFUSED');
    expect(world.refunds).toEqual(['user-1']);
    expect(world.snapshots).toHaveLength(0);
    expect(world.chapter.version).toBe(3);
    // The objectives and organisation sections need no passage and were still attempted…
    expect(world.logged.filter((c) => c.tier === 'strong').length).toBeGreaterThan(0);
    // …but the mock writes nothing from an empty passage list, so nothing was delivered.
    expect(result.drafted).toBe(0);
  });

  it('does not run twice: a build that is not QUEUED is left alone', async () => {
    const world = fakeWorld();
    world.build.status = 'DONE';
    const result = await runChapterBuild(job, world.deps);
    expect(result.status).toBe('FAILED');
    expect(world.logged).toHaveLength(0);
  });
});

describe('planning', () => {
  it('reads the chapter role from the title, then the template', () => {
    expect(
      chapterRoleOf(
        { title: 'Review of Literature', order: 1, outlineNodeId: 'x' },
        [],
        'STEM_EMPIRICAL',
      ),
    ).toBe('LITERATURE');
    expect(
      chapterRoleOf({ title: 'Chapter 4', order: 3, outlineNodeId: 'x' }, [], 'STEM_EMPIRICAL'),
    ).toBe('RESULTS');
    expect(
      chapterRoleOf(
        { title: 'Chapter 4', order: 3, outlineNodeId: 'x' },
        [{ id: 'x', title: 'Chapter 4', scopeNote: '', children: [], role: 'METHOD' } as never],
        'STEM_EMPIRICAL',
      ),
    ).toBe('METHOD');
  });

  it('gives every key term a section before the objectives and stays within fourteen sections', async () => {
    const { applicableElements, blueprintFor, disciplineProfile } = await import('@tc/config');
    const discipline = disciplineProfile('engineering_core_v1');
    const blueprint = blueprintFor('INTRODUCTION');
    if (!blueprint) throw new Error('no blueprint');
    const elements = applicableElements(blueprint, {
      paradigm: 'experimental',
      requiresTheoreticalFramework: false,
      chapterSummaryRequired: true,
    });
    const entities = [
      {
        id: 'E01',
        text: 'AA7050',
        type: 'MATERIAL',
        aliases: [],
        sourceObjective: 1,
        coveredBy: [],
      },
      { id: 'E02', text: 'TiC', type: 'MATERIAL', aliases: [], sourceObjective: 1, coveredBy: [] },
      {
        id: 'E03',
        text: 'stir casting',
        type: 'PROCESS',
        aliases: [],
        sourceObjective: 1,
        coveredBy: [],
      },
      { id: 'E04', text: 'SSCC', type: 'TEST', aliases: [], sourceObjective: 2, coveredBy: [] },
      {
        id: 'E05',
        text: 'finite element model',
        type: 'MODEL',
        aliases: [],
        sourceObjective: 2,
        coveredBy: [],
      },
      {
        id: 'E06',
        text: 'aerospace',
        type: 'UNKNOWN_TYPE',
        aliases: [],
        sourceObjective: 2,
        coveredBy: [],
      },
    ];
    const sections = planSections(elements, entities, ['o1', 'o2'], discipline, []);
    expect(sections.length).toBeLessThanOrEqual(14);
    const objectives = sections.findIndex((s) => s.isObjectives);
    expect(objectives).toBeGreaterThan(0);
    const before = sections.slice(0, objectives).flatMap((s) => s.entities);
    for (const e of entities) expect(before, e.text).toContain(e.id);
    expect(
      sections.filter((s) => s.blueprintRef === 'intro.subject').length,
    ).toBeGreaterThanOrEqual(2);
    expect(sections.at(-1)?.summary).toBe(true);
  });
});
