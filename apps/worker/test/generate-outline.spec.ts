/**
 * `generate-outline` — PRD FR-3.2, FR-3.4, A.9; PHASES v2 W8, "Tests owed (week 8)".
 *
 *   "`generate-outline` against a fake Prisma: chapters created, renamed on re-run, never deleted."
 *
 * The rule that matters is the last one. A `Chapter` row holds the student's writing, and the
 * outline is a plan that changes: a re-run that renamed a node must rename the chapter, and a
 * re-run that dropped one must **leave the chapter alone and say so**. Deleting it would delete
 * the words. `orphaned` is what the screen uses to offer the choice.
 */

import type { LlmProvider, LlmRequest } from '@tc/ai';
import { TEMPLATE_SPECS } from '@tc/config';
import type { OutlineNode } from '@tc/types';
import { describe, expect, it, vi } from 'vitest';
import {
  type GenerateOutlineDeps,
  isBlankChapter,
  runGenerateOutline,
  sectionTitles,
  syncChapters,
} from '../src/jobs/generate-outline.js';

const SCOPE = {
  workingTitle: 'A low-cost forced-convection solar dryer for coastal fish',
  problemStatement: 'Open-air drying loses a fifth of the catch.',
  objectives: ['Design the dryer', 'Measure drying curves'],
};

const CHAPTERS = TEMPLATE_SPECS.STEM_EMPIRICAL.chapters;

const node = (title: string, scopeNote = `About ${title}.`) => ({
  id: title.toLowerCase().replace(/\W+/g, '-'),
  title,
  scopeNote,
  children: [],
});

type ChapterRow = {
  id: string;
  outlineNodeId: string;
  title: string;
  scopeNote: string | null;
  order: number;
  wordCount: number;
  content?: unknown;
};

type Fakes = {
  deps: GenerateOutlineDeps;
  requests: LlmRequest[];
  created: Array<Record<string, unknown>>;
  updates: Array<{ where: unknown; data: Record<string, unknown> }>;
  deletes: number;
  outline: () => OutlineNode[] | null;
  calls: Array<Record<string, unknown>>;
};

function fakes(
  options: {
    scope?: unknown;
    template?: string | null;
    answer?: unknown;
    fail?: boolean;
    chapters?: ChapterRow[];
    extraction?: unknown;
  } = {},
): Fakes {
  const requests: LlmRequest[] = [];
  const created: Array<Record<string, unknown>> = [];
  const updates: Array<{ where: unknown; data: Record<string, unknown> }> = [];
  const calls: Array<Record<string, unknown>> = [];
  let deletes = 0;
  let outline: OutlineNode[] | null = null;

  const deps = {
    prisma: {
      document: {
        findUnique: vi.fn(async () => ({
          id: 'doc-1',
          title: 'Barriers to rooftop solar adoption in rural Karnataka',
          template: 'template' in options ? options.template : 'STEM_EMPIRICAL',
          memory: { scope: 'scope' in options ? options.scope : SCOPE, gapMap: null },
          seedPapers: options.extraction ? [{ extraction: options.extraction }] : [],
        })),
        update: vi.fn(async () => ({})),
      },
      documentMemory: {
        update: vi.fn(async ({ data }: { data: { outline: OutlineNode[] } }) => {
          outline = data.outline;
          return {};
        }),
      },
      chapter: {
        findMany: vi.fn(async () => options.chapters ?? []),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return { id: `ch-${created.length}` };
        }),
        update: vi.fn(async (args: { where: unknown; data: Record<string, unknown> }) => {
          updates.push(args);
          return {};
        }),
        delete: vi.fn(async () => {
          deletes += 1;
          return {};
        }),
        deleteMany: vi.fn(async () => {
          deletes += 1;
          return { count: 1 };
        }),
      },
      aiCallLog: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          calls.push(data);
          return {};
        }),
      },
    },
    llm: {
      modelIdFor: (tier: string) => `mock-${tier}`,
      complete: vi.fn(async (request: LlmRequest) => {
        requests.push(request);
        if (options.fail) throw new Error('the model refused');
        return {
          value: options.answer ?? { outline: CHAPTERS.map((c) => node(c.title)) },
          modelId: 'mock-strong',
          usage: { inputTokens: 500, outputTokens: 400 },
        };
      }),
    } as unknown as LlmProvider,
    aiProvider: 'mock' as const,
    emptyChapter: (title: string) => ({ type: 'doc', content: [{ type: 'heading', title }] }),
    log: () => undefined,
  } as unknown as GenerateOutlineDeps;

  return {
    deps,
    requests,
    created,
    updates,
    get deletes() {
      return deletes;
    },
    outline: () => outline,
    calls,
  };
}

const JOB = { documentId: 'doc-1', userId: 'user-1' };

describe('generating an outline', () => {
  it('writes the tree to document memory and a chapter row for each top-level node', async () => {
    const f = fakes();
    const result = await runGenerateOutline(JOB, f.deps);

    expect(result.chapters).toBe(CHAPTERS.length);
    expect(result.created).toBe(CHAPTERS.length);
    expect(result.updated).toBe(0);
    expect(result.orphaned).toEqual([]);
    expect(f.outline()).toHaveLength(CHAPTERS.length);
    expect(f.created.map((c) => c.title)).toEqual(CHAPTERS.map((c) => c.title));
  });

  it('keys every chapter on its outline node, which is how FR-3.4 keeps them in step', async () => {
    const f = fakes();
    await runGenerateOutline(JOB, f.deps);
    for (const chapter of f.created) {
      expect(typeof chapter.outlineNodeId).toBe('string');
      expect(chapter.outlineNodeId).not.toBe('');
    }
    const ids = f.created.map((c) => c.outlineNodeId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('numbers the chapters from one, in outline order', async () => {
    const f = fakes();
    await runGenerateOutline(JOB, f.deps);
    expect(f.created.map((c) => c.order)).toEqual(CHAPTERS.map((_, i) => i + 1));
  });

  it('makes one Strong call and logs it as OUTLINE', async () => {
    const f = fakes();
    await runGenerateOutline(JOB, f.deps);
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0]?.tier).toBe('strong');
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]?.action).toBe('OUTLINE');
    expect(f.calls[0]?.ok).toBe(true);
  });

  it('restores a chapter the model dropped, rather than shipping a thesis missing one', async () => {
    // A.9's first rule, at the job level: the template's shape is not a suggestion.
    const f = fakes({ answer: { outline: [node(CHAPTERS[0]?.title ?? 'Introduction')] } });
    const result = await runGenerateOutline(JOB, f.deps);
    expect(result.chapters).toBe(CHAPTERS.length);
    const restored = f.created.find((c) => c.title === CHAPTERS[1]?.title);
    expect(String(restored?.scopeNote)).toContain('added from the template');
  });

  it('counts the sections under the chapters separately', async () => {
    const f = fakes({
      answer: {
        outline: CHAPTERS.map((c, i) =>
          i === 0
            ? { ...node(c.title), children: [node('Background'), node('Objectives')] }
            : node(c.title),
        ),
      },
    });
    const result = await runGenerateOutline(JOB, f.deps);
    expect(result.sections).toBe(2);
    // Sections are part of the tree, not chapters of their own.
    expect(f.created).toHaveLength(CHAPTERS.length);
  });

  it('records the template it used when the document had none', async () => {
    const f = fakes({ template: null });
    const result = await runGenerateOutline(JOB, f.deps);
    expect(result.template).toBe('STEM_EMPIRICAL');
    expect(f.deps.prisma.document.update).toHaveBeenCalled();
  });
});

describe('re-running over a document that already has chapters', () => {
  const existing: ChapterRow[] = CHAPTERS.map((c, i) => ({
    id: `ch-${i + 1}`,
    outlineNodeId: c.title.toLowerCase().replace(/\W+/g, '-'),
    title: c.title,
    scopeNote: `About ${c.title}.`,
    order: i + 1,
    wordCount: 500,
  }));

  it('creates nothing and changes nothing when the outline is the same', async () => {
    const f = fakes({ chapters: existing });
    const result = await runGenerateOutline(JOB, f.deps);
    expect(result.created).toBe(0);
    expect(result.updated).toBe(0);
    expect(f.created).toHaveLength(0);
  });

  it('renames a chapter whose node was renamed, keeping its id and its words', async () => {
    const renamed = CHAPTERS.map((c, i) =>
      i === 0 ? { ...node(c.title), title: 'Introduction and motivation' } : node(c.title),
    );
    const f = fakes({ chapters: existing, answer: { outline: renamed } });
    const result = await runGenerateOutline(JOB, f.deps);
    expect(result.updated).toBeGreaterThanOrEqual(1);
    expect(f.created).toHaveLength(0);
    expect(f.updates[0]?.where).toEqual({ id: 'ch-1' });
    expect(f.updates[0]?.data.title).toBe('Introduction and motivation');
  });

  it('never deletes a chapter, whatever the new outline says', async () => {
    // The row holds the student's writing. A re-run is a plan changing, not a licence to delete.
    const f = fakes({
      chapters: existing,
      answer: { outline: [node(CHAPTERS[0]?.title ?? 'Introduction')] },
    });
    await runGenerateOutline(JOB, f.deps);
    expect(f.deletes).toBe(0);
  });

  it('reports a chapter the new outline no longer has, so the screen can offer the choice', async () => {
    const withExtra: ChapterRow[] = [
      ...existing,
      {
        id: 'ch-extra',
        outlineNodeId: 'a-chapter-the-student-added',
        title: 'A chapter the student added',
        scopeNote: null,
        order: 99,
        wordCount: 1_200,
      },
    ];
    const f = fakes({ chapters: withExtra });
    const result = await runGenerateOutline(JOB, f.deps);
    expect(result.orphaned).toContain('ch-extra');
    expect(f.deletes).toBe(0);
  });
});

describe('when it cannot run', () => {
  it('refuses before any call when the proposal has not been saved', async () => {
    const f = fakes({ scope: null });
    await expect(runGenerateOutline(JOB, f.deps)).rejects.toThrow(/Save the proposal first/);
    expect(f.requests).toHaveLength(0);
    expect(f.calls).toHaveLength(0);
  });

  it('logs a provider failure as a failure rather than losing it', async () => {
    const f = fakes({ fail: true });
    await expect(runGenerateOutline(JOB, f.deps)).rejects.toThrow('the model refused');
    expect(f.calls[0]?.ok).toBe(false);
    expect(String(f.calls[0]?.error)).toContain('the model refused');
  });

  it('refuses an empty outline rather than emptying the document', async () => {
    // `enforceTemplateShape` restores a fixed-count template, so an empty answer only survives for
    // a flexible one — where it would otherwise write an outline with no chapters at all.
    const flexible = (['STEM_EMPIRICAL', 'QUALITATIVE', 'COMPILATION'] as const).find(
      (t) => TEMPLATE_SPECS[t].flexibleChapterCount,
    );
    if (!flexible) return;
    const f = fakes({ template: flexible, answer: { outline: [] } });
    await expect(runGenerateOutline(JOB, f.deps)).rejects.toThrow(/came back empty/);
    expect(f.outline()).toBe(null);
  });
});

describe('the first outline of a new thesis (2026-10-04)', () => {
  const firstChapter: ChapterRow = {
    id: 'ch-1',
    outlineNodeId: 'initial-node',
    title: 'Chapter 1 — Introduction',
    scopeNote: null,
    order: 1,
    wordCount: 42,
  };

  it('makes the one existing chapter the first of the outline, keeping its id and words', async () => {
    const f = fakes({ chapters: [firstChapter] });
    const result = await syncChapters(f.deps, 'doc-1', [
      node('Introduction'),
      node('Literature Review'),
      node('Methodology'),
    ]);
    expect(result.orphaned).toEqual([]);
    expect(result.created).toBe(2);
    const adopted = f.updates.find((u) => (u.where as { id: string }).id === 'ch-1');
    expect(adopted?.data).toMatchObject({ outlineNodeId: 'introduction', title: 'Introduction' });
    expect(f.deletes).toBe(0);
  });

  it('leaves a lone chapter alone when the outline already has it', async () => {
    const f = fakes({ chapters: [{ ...firstChapter, outlineNodeId: 'introduction' }] });
    const result = await syncChapters(f.deps, 'doc-1', [node('Introduction'), node('Methods')]);
    expect(result.orphaned).toEqual([]);
    const adopted = f.updates.find((u) => 'outlineNodeId' in (u.data ?? {}));
    expect(adopted).toBeUndefined();
  });

  it('never adopts when the thesis already has several chapters', async () => {
    const f = fakes({
      chapters: [firstChapter, { ...firstChapter, id: 'ch-2', outlineNodeId: 'second', order: 2 }],
    });
    const result = await syncChapters(f.deps, 'doc-1', [node('Introduction')]);
    expect(result.orphaned).toEqual(['ch-1', 'ch-2']);
  });
});

describe('syncChapters on its own', () => {
  it('is the single place chapter rows follow the tree', async () => {
    const f = fakes();
    const result = await syncChapters(f.deps, 'doc-1', [node('Introduction'), node('Methodology')]);
    expect(result).toEqual({ created: 2, updated: 0, orphaned: [] });
  });

  it('re-orders a chapter that moved without touching its title', async () => {
    const f = fakes({
      chapters: [
        {
          id: 'ch-1',
          outlineNodeId: 'methodology',
          title: 'Methodology',
          scopeNote: 'About Methodology.',
          order: 1,
          wordCount: 100,
        },
      ],
    });
    await syncChapters(f.deps, 'doc-1', [node('Introduction'), node('Methodology')]);
    const move = f.updates.find((u) => (u.where as { id: string }).id === 'ch-1');
    expect(move?.data.order).toBe(2);
    expect(move?.data.title).toBe('Methodology');
  });
});

describe('planning from the title alone (ADR-0072)', () => {
  const TITLE_JOB = { ...JOB, fromTitle: true };

  it('sends A.9 the title as the working title when no proposal is saved', async () => {
    const f = fakes({ scope: {} });
    const result = await runGenerateOutline(TITLE_JOB, f.deps);
    expect(result.chapters).toBeGreaterThan(0);
    const message = String(f.requests[0]?.messages.at(-1)?.content ?? '');
    expect(message).toContain(
      'Working title: Barriers to rooftop solar adoption in rural Karnataka',
    );
    // Same action, same prompt: the call is logged as an ordinary OUTLINE call.
    expect(f.requests[0]?.action).toBe('OUTLINE');
    expect(f.calls[0]?.action).toBe('OUTLINE');
  });

  it('uses the proposal instead when one was saved before the job ran', async () => {
    const f = fakes();
    await runGenerateOutline(TITLE_JOB, f.deps);
    const message = String(f.requests[0]?.messages.at(-1)?.content ?? '');
    expect(message).toContain(`Working title: ${SCOPE.workingTitle}`);
    expect(message).toContain(SCOPE.problemStatement);
  });

  it('still refuses an empty scope when the job did not ask for the title', async () => {
    const f = fakes({ scope: {} });
    await expect(runGenerateOutline(JOB, f.deps)).rejects.toThrow(/Save the proposal first/);
    expect(f.requests).toHaveLength(0);
  });

  it('maps the first planned chapter onto Chapter 1 without touching what the student wrote', async () => {
    // The student has been typing in Chapter 1 while the plan was made.
    const f = fakes({
      scope: {},
      chapters: [
        {
          id: 'ch-typed',
          outlineNodeId: 'ch-1',
          title: 'Chapter 1',
          scopeNote: null,
          order: 1,
          wordCount: 180,
        },
      ],
    });
    const result = await runGenerateOutline(TITLE_JOB, f.deps);
    expect(result.orphaned).toEqual([]);
    expect(f.deletes).toBe(0);
    const adopted = f.updates.filter((u) => (u.where as { id: string }).id === 'ch-typed');
    expect(adopted.length).toBeGreaterThan(0);
    for (const update of adopted) expect(update.data).not.toHaveProperty('content');
    expect(adopted[0]?.data).toMatchObject({ order: 1, title: CHAPTERS[0]?.title });
    // The other chapters are new rows; Chapter 1 is not duplicated.
    expect(f.created).toHaveLength(CHAPTERS.length - 1);
  });

  it('ADR-0087: an untouched Chapter 1 gets the planned sections as headings', async () => {
    const f = fakes({
      scope: {},
      chapters: [
        {
          id: 'ch-blank',
          outlineNodeId: 'ch-1',
          title: 'Chapter 1',
          scopeNote: null,
          order: 1,
          wordCount: 0,
          content: {
            type: 'doc',
            content: [
              {
                type: 'heading',
                attrs: { level: 1 },
                content: [{ type: 'text', text: 'Chapter 1' }],
              },
              { type: 'paragraph' },
            ],
          },
        },
      ],
    });
    await runGenerateOutline(TITLE_JOB, f.deps);
    const adopted = f.updates.find((u) => (u.where as { id: string }).id === 'ch-blank');
    expect(adopted?.data).toHaveProperty('content');
  });
});

describe('ADR-0087: chapter bodies', () => {
  it('a body is blank when it holds only headings and empty lines', () => {
    const heading = (text: string) => ({
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text }],
    });
    expect(
      isBlankChapter({ type: 'doc', content: [heading('Intro'), { type: 'paragraph' }] }),
    ).toBe(true);
    expect(
      isBlankChapter({
        type: 'doc',
        content: [heading('Intro'), { type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }],
      }),
    ).toBe(false);
  });

  it('the sections of a chapter are the titles of its children', () => {
    expect(
      sectionTitles({
        id: 'ch-1',
        title: 'Introduction',
        scopeNote: '',
        children: [
          { id: 's1', title: 'Background', scopeNote: '', children: [] },
          { id: 's2', title: ' Aims ', scopeNote: '', children: [] },
        ],
      }),
    ).toEqual(['Background', 'Aims']);
  });
});
