/**
 * The literature review build — ADR-0124, driven end to end on the mock provider with a fake
 * database, as the chapter build's own spec is.
 *
 * What is pinned: a `LIT_REVIEW` job plans the literature blueprint with one section per confirmed
 * theme, in the student's order, and never more than `LIT_REVIEW_BUILD_MAX_SECTIONS`; a theme from
 * the outline keeps its subheadings (A.2 `children`); every section is delivered as a pending draft
 * block with DRAFT provenance and a `LIT_REVIEW_BUILD` suggestion event (so Accept finds it); every
 * model call carries a time limit; a review that can write nothing is REFUSED and gives its unit
 * back; with no themes left it is planned from the key terms, as a chapter build is. And the email.
 */

import {
  MockLlmProvider,
  mockDraftFor,
  mockEntitiesFor,
  mockExaminerFor,
  mockFixFor,
  mockProofreadResponse,
} from '@tc/ai';
import {
  applicableElements,
  blueprintFor,
  disciplineProfile,
  LIT_REVIEW_BUILD_MAX_SECTIONS,
  universityProfile,
} from '@tc/config';
import {
  type ChapterBuildJob,
  type ChapterBuildReport,
  LIT_REVIEW_MAX_THEMES,
  type LitReviewTheme,
} from '@tc/types';
import { describe, expect, it, vi } from 'vitest';
import { jobEmail, litReviewBuildFinished, resultPath } from '../src/job-email.js';
import {
  type BuildCallLog,
  type ChapterBuildDeps,
  planLiteratureReview,
  runChapterBuild,
} from '../src/jobs/chapter-build.js';

/** Twenty unrelated statements, one per section, so no section's text repeats another's. */
const FINDINGS = [
  'Dry sliding wear of the composite fell as the ceramic fraction rose to twelve percent.',
  'Graphite films formed on the counterface above five weight percent of lubricant phase.',
  'Stir casting at seven hundred and fifty degrees spread the particles evenly through the billet.',
  'Squeeze casting closed the porosity that gravity casting left near the riser.',
  'Hardness of the matrix rose by forty percent with ten micrometre titanium carbide.',
  'Pin-on-disc tests at twenty newtons showed a change from adhesive to abrasive wear.',
  'Fracture surfaces showed particle pull-out where the interface had reacted.',
  'Ageing at one hundred and twenty degrees recovered the strength lost during casting.',
  'Response surface models of hardness needed twenty runs to fit three factors.',
  'Corrosion current density fell as the graphite content of the composite increased.',
  'Wire electrical discharge machining cut the specimens without measurable tool wear.',
  'Finite element models of the contact predicted subsurface stresses within fifteen percent.',
  'Hybrid reinforcement balanced strength against machinability in every reported batch.',
  'Coefficient of friction stabilised after the first two hundred metres of sliding distance.',
  'Oxide tribolayers protected the surface at sliding speeds above two metres per second.',
  'Particle clustering lowered the elongation to failure in tensile tests of the castings.',
  'Ultrasonic treatment of the melt broke up clusters before the particles were added.',
  'Thermal conductivity of the composite dropped as the ceramic share was increased.',
  'Wear debris examined by microscopy contained iron transferred from the steel disc.',
  'Micro-hardness was highest next to the particles and fell away towards the matrix.',
];

const theme = (n: number, extra: Partial<LitReviewTheme> = {}): LitReviewTheme => ({
  id: `t${n}`,
  title: `Theme ${n}: wear mechanism ${n}`,
  note: '',
  outlineNodeId: null,
  children: [],
  from: 'library',
  ...extra,
});

function fakeWorld(
  options: { passages?: boolean; themes?: LitReviewTheme[]; evidenceMisses?: number } = {},
) {
  let misses = 0;
  const chapter = {
    id: 'ch-2',
    documentId: 'doc-1',
    outlineNodeId: 'ch2-literature',
    title: 'Literature Review',
    order: 1,
    scopeNote: 'Review the field.',
    content: {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Literature Review' }],
        },
      ],
    },
    version: 2,
  };
  const build: Record<string, unknown> = {
    id: 'build-r',
    kind: 'LIT_REVIEW',
    status: 'QUEUED',
    documentId: 'doc-1',
    chapterId: 'ch-2',
    userId: 'user-1',
    plan: {
      chapterRole: 'LITERATURE',
      entities: [],
      sections: [],
      coverage: {},
      uncovered: [],
      clarifications: [],
      confirmedAt: '2026-10-08T00:00:00.000Z',
      themes: options.themes ?? [
        theme(1, {
          title: 'Wear of hybrid aluminium composites',
          note: 'Dry sliding wear and the role of the lubricant phase.',
          outlineNodeId: 'ch2-wear',
          children: [
            { title: 'Adhesive wear', scopeNote: 'Below the transition load.' },
            { title: 'Abrasive wear', scopeNote: 'Above it.' },
          ],
          from: 'outline',
        }),
        theme(2, { title: 'Processing routes for particle composites' }),
        theme(3, { title: 'Corrosion behaviour', from: 'student' }),
      ],
    },
  };
  const snapshots: unknown[] = [];
  const logged: BuildCallLog[] = [];
  const refunds: string[] = [];
  const events: Array<Record<string, unknown>> = [];
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
        title: 'Wear of AA7050 hybrid composites',
        field: 'Mechanical Engineering',
        language: 'en',
        template: 'STEM_EMPIRICAL',
        meta: { thesisDetails: { degree: 'PhD' } },
      })),
    },
    documentMemory: {
      findUnique: vi.fn(async () => ({
        scope: {
          workingTitle: 'Wear of AA7050 hybrid composites',
          problemStatement: 'p',
          objectives: ['To evaluate the dry sliding wear of AA7050/TiC/graphite composites.'],
          whyOpen: 'w',
        },
        outline: [
          { id: 'ch1-introduction', title: 'Introduction', scopeNote: 'i', children: [] },
          {
            id: 'ch2-literature',
            title: 'Literature Review',
            scopeNote: 'Review the field.',
            children: [
              {
                id: 'ch2-wear',
                title: 'Wear of hybrid aluminium composites',
                scopeNote: 'Dry sliding wear.',
                children: [],
              },
            ],
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
      findMany: vi.fn(async () => []),
      update: vi.fn(async () => ({})),
    },
    source: {
      findMany: vi.fn(async () => [
        {
          id: 'src-1',
          title: 'Wear of aluminium composites',
          authors: [{ family: 'Rao', given: 'S' }],
          year: 2022,
          doi: '10.1000/w',
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
      // The first `evidenceMisses` look-ups find nothing: the evidence step, before any search.
      if (misses < (options.evidenceMisses ?? 0)) {
        misses++;
        return { passages: [], byKey: new Map() };
      }
      const text = FINDINGS[retrievals++ % FINDINGS.length] as string;
      return {
        passages: [
          { id: 'S1#c1', shortRef: 'Rao 2022', page: 2, text, sourceId: 'src-1', chunkId: 'k-1' },
        ],
        byKey: new Map([['S1#c1', { sourceId: 'src-1', chunkId: 'k-1', shortRef: 'Rao 2022' }]]),
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

  return { deps, build, chapter, snapshots, logged, refunds, events, llm };
}

const job: ChapterBuildJob = {
  buildId: 'build-r',
  documentId: 'doc-1',
  chapterId: 'ch-2',
  userId: 'user-1',
  profile: {
    disciplineId: 'engineering_core_v1',
    paradigm: 'experimental',
    universityId: 'generic_author_year_v1',
  },
  kind: 'LIT_REVIEW',
};

describe('the literature review build (ADR-0124)', () => {
  it('writes one section per confirmed theme, in order, and delivers each as a pending draft', async () => {
    const world = fakeWorld();
    const result = await runChapterBuild(job, world.deps);
    expect(result.status).toBe('DONE');
    expect(world.build.status).toBe('DONE');

    const report = world.build.report as ChapterBuildReport;
    const titles = report.sections.map((s) => s.title);
    // The review's introduction, the three themes as the student ordered them, then the rest.
    expect(titles[0]).toBe('Introduction to the review');
    expect(titles.slice(1, 4)).toEqual([
      'Wear of hybrid aluminium composites',
      'Processing routes for particle composites',
      'Corrosion behaviour',
    ]);
    expect(titles).toContain('Critical gap analysis');
    expect(report.sections.filter((s) => s.blueprintRef === 'lit.theme')).toHaveLength(3);

    // Flag, don't fix: pending draft blocks with DRAFT provenance, found by Accept under the
    // review's own action.
    const blocks = (
      world.chapter.content as { content: Array<{ type: string; attrs?: { status?: string } }> }
    ).content;
    const drafts = blocks.filter((b) => b.type === 'draftBlock');
    expect(drafts).toHaveLength(result.drafted);
    expect(result.drafted).toBeGreaterThanOrEqual(5);
    expect(drafts.every((d) => d.attrs?.status === 'pending')).toBe(true);
    expect(JSON.stringify(drafts)).toContain('"kind":"DRAFT"');
    expect(world.events).toHaveLength(result.drafted);
    expect(world.events.every((e) => e.action === 'LIT_REVIEW_BUILD')).toBe(true);
    expect(world.snapshots).toHaveLength(1);

    // The outline theme kept its subheadings: A.2 was asked for them, and they were delivered.
    const wear = world.llm.calls.find(
      (c) =>
        c.action === 'DRAFT' &&
        c.messages[0]?.content.includes('Wear of hybrid aluminium composites'),
    );
    expect(wear?.messages[0]?.content).toContain('Adhesive wear');
    expect(JSON.stringify(drafts)).toContain('Abrasive wear');

    // The plan kept the themes, and the build kept to its own key terms.
    expect((world.build.plan as { themes: LitReviewTheme[] }).themes).toHaveLength(3);
    // Every model call has a time limit; nothing was refunded on a delivered review.
    expect(world.llm.calls.length).toBeGreaterThan(0);
    expect(world.llm.calls.every((c) => c.signal instanceof AbortSignal)).toBe(true);
    expect(world.refunds).toHaveLength(0);
    expect(world.logged.every((c) => c.ok)).toBe(true);
  });

  it('never writes more than its section cap, however many themes arrive', async () => {
    const many = Array.from({ length: LIT_REVIEW_MAX_THEMES + 4 }, (_, i) => theme(i + 1));
    const world = fakeWorld({ themes: many });
    const result = await runChapterBuild(job, world.deps);
    expect(result.status).toBe('DONE');
    expect(result.sections).toBeLessThanOrEqual(LIT_REVIEW_BUILD_MAX_SECTIONS);
    const report = world.build.report as ChapterBuildReport;
    expect(report.sections.filter((s) => s.blueprintRef === 'lit.theme')).toHaveLength(
      LIT_REVIEW_MAX_THEMES,
    );
    // Fifteen themes and the five fixed elements are exactly the priced twenty sections.
    expect(LIT_REVIEW_MAX_THEMES + 5).toBe(LIT_REVIEW_BUILD_MAX_SECTIONS);
    // Each section is drafted once and examined at most once; the fixes are at most half.
    const drafts = world.llm.calls.filter((c) => c.action === 'DRAFT');
    expect(drafts.length).toBeLessThanOrEqual(LIT_REVIEW_BUILD_MAX_SECTIONS);
    const examiner = world.llm.calls.filter((c) => c.messages[0]?.content.startsWith('<review'));
    expect(examiner.length).toBeLessThanOrEqual(LIT_REVIEW_BUILD_MAX_SECTIONS);
    const fixes = world.llm.calls.filter((c) => c.messages[0]?.content.startsWith('<fix>'));
    expect(fixes.length).toBeLessThanOrEqual(LIT_REVIEW_BUILD_MAX_SECTIONS / 2);
  });

  it('searches for each theme the library does not cover, on that theme’s own key', async () => {
    // The introduction and the three themes find nothing in the library at first.
    const world = fakeWorld({ evidenceMisses: 4 });
    const asked: Array<{ chapterId: string; query: string; section?: string }> = [];
    world.deps.findSources = vi.fn(async (input) => {
      asked.push(input);
      return true;
    });
    world.deps.sleep = async () => undefined;
    const result = await runChapterBuild(job, world.deps);
    expect(result.status).toBe('DONE');
    expect(asked.map((a) => a.section)).toEqual([
      'Introduction to the review',
      'Wear of hybrid aluminium composites',
      'Processing routes for particle composites',
      'Corrosion behaviour',
    ]);
    expect(asked.every((a) => a.chapterId === 'ch-2')).toBe(true);
    expect(asked[1]?.query).toContain('Wear of AA7050 hybrid composites.');
  });

  it('is REFUSED and gives its unit back when nothing can be written', async () => {
    const world = fakeWorld({ passages: false });
    const result = await runChapterBuild(job, world.deps);
    expect(result.status).toBe('REFUSED');
    expect(result.refunded).toBe(true);
    expect(world.refunds).toEqual(['user-1']);
    expect(world.snapshots).toHaveLength(0);
    expect(world.chapter.version).toBe(2);
  });
});

describe('planLiteratureReview', () => {
  const discipline = disciplineProfile('engineering_core_v1');
  const blueprint = blueprintFor('LITERATURE');
  if (!blueprint) throw new Error('no literature blueprint');
  const elements = applicableElements(blueprint, {
    paradigm: 'experimental',
    requiresTheoreticalFramework: true,
    chapterSummaryRequired: universityProfile('generic_author_year_v1').chapterSummaryRequired,
  });
  const entities = [
    {
      id: 'E01',
      text: 'graphite',
      type: 'MATERIAL',
      aliases: [],
      sourceObjective: 1,
      coveredBy: [],
    },
    {
      id: 'E02',
      text: 'TiC',
      type: 'MATERIAL',
      aliases: ['titanium carbide'],
      sourceObjective: 1,
      coveredBy: [],
    },
    {
      id: 'E03',
      text: 'pin-on-disc',
      type: 'TEST',
      aliases: [],
      sourceObjective: 1,
      coveredBy: [],
    },
  ];

  it('gives each key term to the theme that names it, the rest to the first theme', () => {
    const sections = planLiteratureReview(
      elements,
      entities,
      ['o1'],
      discipline,
      [],
      [
        theme(1, { title: 'Solid lubricants', note: 'Graphite films and their transfer.' }),
        theme(2, { title: 'Titanium carbide reinforcement' }),
      ],
    );
    const lubricants = sections.find((s) => s.title === 'Solid lubricants');
    const carbide = sections.find((s) => s.title === 'Titanium carbide reinforcement');
    expect(lubricants?.entities).toEqual(['E01', 'E03']);
    expect(carbide?.entities).toEqual(['E02']);
    expect(sections.map((s) => s.blueprintRef)).toContain('lit.framework');
    expect(sections.length).toBeLessThanOrEqual(LIT_REVIEW_BUILD_MAX_SECTIONS);
  });

  it('with no theme left, plans from the key terms exactly as a chapter build does', async () => {
    const { planSections } = await import('../src/jobs/chapter-build.js');
    expect(planLiteratureReview(elements, entities, ['o1'], discipline, [], [])).toEqual(
      planSections(elements, entities, ['o1'], discipline, []),
    );
  });
});

describe('the email when a review finishes (ADR-0058)', () => {
  it('names the literature review and links to the build screen', () => {
    const done = litReviewBuildFinished(
      job,
      { buildId: 'build-r', status: 'DONE', sections: 8, drafted: 8, blockingOpen: 0, spentInr: 1 },
      Date.now() - 600_000,
    );
    expect(done?.kind).toBe('literature-review');
    expect(done && resultPath(done)).toBe('/app/d/doc-1/build');
    const mail = done ? jobEmail(done, 'Wear of AA7050', 'https://app.example') : null;
    expect(mail?.subject).toBe('Your literature review is ready — Wear of AA7050');
    expect(mail?.text).toContain('8 sections of your literature review are waiting');

    const failed = litReviewBuildFinished(
      job,
      {
        buildId: 'build-r',
        status: 'REFUSED',
        sections: 8,
        drafted: 0,
        blockingOpen: 0,
        spentInr: 0,
        refunded: true,
      },
      Date.now() - 600_000,
    );
    const failMail = failed ? jobEmail(failed, 'Wear of AA7050', 'https://app.example') : null;
    expect(failMail?.text).toContain(
      'Nothing was charged: the literature review build went back to your monthly allowance.',
    );
    // A retry of a build already handled sends nothing.
    expect(
      litReviewBuildFinished(
        job,
        {
          buildId: 'build-r',
          status: 'FAILED',
          sections: 0,
          drafted: 0,
          blockingOpen: 0,
          spentInr: 0,
          skipped: true,
        },
        Date.now(),
      ),
    ).toBeNull();
  });
});
