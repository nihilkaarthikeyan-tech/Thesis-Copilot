/**
 * Chapter build through its real HTTP path — ADR-0039.
 *
 * The cap test every metered action has: starting a build is one `CHAPTER_BUILD` unit, taken
 * before the job is queued, and at the cap the refusal comes with no row and no job. Around it:
 * the refusals that cost nothing (no outline yet; drafts from a previous build still waiting), the
 * profile that is kept on the document, the pitfall report that goes to the queue as pending, and
 * the student's decision on an issue, which never touches the chapter.
 */

import type { Prisma } from '@tc/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { periodFor } from '../src/modules/usage/usage.service.js';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let documentId: string;
let chapterId: string;

/** FREE_TRIAL's `CHAPTER_BUILD` cap (ADR-0039). */
const CAP = 1;

async function units(): Promise<number> {
  const row = await h.prisma.usageLedger.findFirst({
    where: { userId: h.userId, action: 'CHAPTER_BUILD', period: periodFor() },
  });
  return row?.count ?? 0;
}

async function setUnits(count: number): Promise<void> {
  await h.prisma.usageLedger.upsert({
    where: {
      userId_period_action: { userId: h.userId, period: periodFor(), action: 'CHAPTER_BUILD' },
    },
    create: { userId: h.userId, period: periodFor(), action: 'CHAPTER_BUILD', count },
    update: { count },
  });
}

async function setOutline(nodes: unknown[]): Promise<void> {
  await h.prisma.documentMemory.upsert({
    where: { documentId },
    create: {
      documentId,
      scope: {
        workingTitle: 'Wear of AA7050 composites',
        problemStatement: 'p',
        objectives: ['To fabricate AA7050/TiC composites by stir casting.'],
        whyOpen: 'w',
      } as Prisma.InputJsonValue,
      outline: nodes as Prisma.InputJsonValue,
      glossary: {},
    },
    update: { outline: nodes as Prisma.InputJsonValue },
  });
}

beforeAll(async () => {
  h = await startHarness('build@example.com');
  const created = await h.api('/documents', {
    method: 'POST',
    body: JSON.stringify({ title: 'Wear of AA7050 composites', entryPath: 'A_TOPIC' }),
  });
  const document = (await created.json()) as { id: string; firstChapterId: string };
  documentId = document.id;
  chapterId = document.firstChapterId;
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(async () => {
  await setUnits(0);
  await h.prisma.chapterBuild.deleteMany({ where: { documentId } });
});

describe('starting a chapter build', () => {
  it('refuses, for nothing, a thesis with no outline', async () => {
    await h.prisma.documentMemory.deleteMany({ where: { documentId } });
    const response = await h.api(`/documents/${documentId}/chapter-build`, {
      method: 'POST',
      body: JSON.stringify({ chapterId }),
    });
    expect(response.status).toBe(400);
    expect(await units()).toBe(0);
    expect(await h.prisma.chapterBuild.count({ where: { documentId } })).toBe(0);
  });

  it('takes one unit, keeps the profile, and queues the build', async () => {
    const chapter = await h.prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    await setOutline([
      {
        id: chapter.outlineNodeId,
        title: chapter.title,
        scopeNote: 'Introduce the work.',
        children: [],
      },
    ]);
    const response = await h.api(`/documents/${documentId}/chapter-build`, {
      method: 'POST',
      body: JSON.stringify({
        chapterId,
        profile: {
          disciplineId: 'engineering_core_v1',
          paradigm: 'experimental',
          universityId: 'generic_author_year_v1',
        },
      }),
    });
    expect(response.status).toBe(202);
    const { buildId } = (await response.json()) as { buildId: string };
    expect(await units()).toBe(1);

    const build = await h.prisma.chapterBuild.findUniqueOrThrow({ where: { id: buildId } });
    expect(build.status).toBe('QUEUED');
    expect(build.chapterId).toBe(chapterId);

    const document = await h.prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(
      (document.meta as { chapterProfile?: { disciplineId: string } }).chapterProfile?.disciplineId,
    ).toBe('engineering_core_v1');

    // The overview shows it, with the allowance used.
    const overview = (await (await h.api(`/documents/${documentId}/chapter-build`)).json()) as {
      builds: Array<{ id: string; status: string }>;
      remaining: { used: number; cap: number };
      profile: { disciplineId: string };
      suggested: boolean;
    };
    expect(overview.builds[0]?.id).toBe(buildId);
    expect(overview.remaining).toEqual({ used: 1, cap: CAP });
    expect(overview.suggested).toBe(false);

    // A second build while one is queued is refused, for nothing.
    const again = await h.api(`/documents/${documentId}/chapter-build`, {
      method: 'POST',
      body: JSON.stringify({ chapterId }),
    });
    expect(again.status).toBe(409);
    expect(await units()).toBe(1);
  });

  it('is refused at the cap, before any row or job', async () => {
    const chapter = await h.prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    await setOutline([
      {
        id: chapter.outlineNodeId,
        title: chapter.title,
        scopeNote: 'Introduce the work.',
        children: [],
      },
    ]);
    await setUnits(CAP);
    const response = await h.api(`/documents/${documentId}/chapter-build`, {
      method: 'POST',
      body: JSON.stringify({ chapterId }),
    });
    expect(response.status).toBe(429);
    expect(await units()).toBe(CAP);
    expect(await h.prisma.chapterBuild.count({ where: { documentId } })).toBe(0);
  });

  it('refuses a chapter whose built sections are still waiting for a decision', async () => {
    const chapter = await h.prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    await setOutline([
      {
        id: chapter.outlineNodeId,
        title: chapter.title,
        scopeNote: 'Introduce the work.',
        children: [],
      },
    ]);
    const previous = chapter.content;
    await h.prisma.chapter.update({
      where: { id: chapterId },
      data: {
        content: {
          type: 'doc',
          content: [
            {
              type: 'draftBlock',
              attrs: { draftId: '00000000-0000-7000-8000-000000000001', status: 'pending' },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Built.' }] }],
            },
          ],
        } as Prisma.InputJsonValue,
      },
    });
    const response = await h.api(`/documents/${documentId}/chapter-build`, {
      method: 'POST',
      body: JSON.stringify({ chapterId }),
    });
    expect(response.status).toBe(409);
    expect(await units()).toBe(0);
    await h.prisma.chapter.update({
      where: { id: chapterId },
      data: { content: previous as Prisma.InputJsonValue },
    });
  });
});

describe('the report and the bank', () => {
  it('records the student’s decision on an issue without touching the chapter', async () => {
    const chapter = await h.prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    const build = await h.prisma.chapterBuild.create({
      data: {
        documentId,
        chapterId,
        userId: h.userId,
        status: 'DONE',
        profile: {
          disciplineId: 'engineering_core_v1',
          paradigm: 'experimental',
          universityId: 'generic_author_year_v1',
        },
        report: {
          sections: [],
          checks: [{ checkId: 'L3', label: 'Abbreviations', status: 'fail', open: 1, fixed: 0 }],
          issues: [
            {
              id: 'i1',
              checkId: 'L3',
              severity: 'blocking',
              sectionId: 's1',
              sentence: 'FRM offers a different route.',
              explanation: '“FRM” is used without being defined.',
              suggestedFix: 'Define it.',
              status: 'open',
              by: 'code',
              pass: 1,
            },
          ],
          evidenceNeeded: [],
          references: [],
          similarity: { copiedRuns: 0, checkedWords: 10 },
          totals: {
            words: 10,
            citations: 0,
            blockingOpen: 1,
            warningsOpen: 0,
            fixed: 0,
            spentInr: 0,
          },
          disclosure: 'x',
          universityUnconfirmed: true,
        },
      },
    });
    const response = await h.api(`/documents/${documentId}/chapter-build/${build.id}/issues/i1`, {
      method: 'POST',
      body: JSON.stringify({ action: 'accept', note: 'FRM is defined in the front matter.' }),
    });
    expect(response.status).toBe(200);
    const view = (await (
      await h.api(`/documents/${documentId}/chapter-build/${build.id}`)
    ).json()) as {
      report: {
        issues: Array<{ status: string; userNote?: string }>;
        totals: { blockingOpen: number };
        checks: Array<{ status: string }>;
      };
    };
    expect(view.report.issues[0]?.status).toBe('accepted_by_user');
    expect(view.report.issues[0]?.userNote).toBe('FRM is defined in the front matter.');
    expect(view.report.totals.blockingOpen).toBe(0);
    expect(view.report.checks[0]?.status).toBe('pass');
    const after = await h.prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    expect(after.version).toBe(chapter.version);
  });

  it('a pitfall report waits as pending and is not in the checked bank until approved', async () => {
    const response = await h.api(`/documents/${documentId}/chapter-build/pitfalls`, {
      method: 'POST',
      body: JSON.stringify({
        topic: 'wear',
        wrongPattern: 'Wear resistance is the same as hardness',
        correctStatement: 'Hardness is one factor in wear resistance, not the same property.',
      }),
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string; status: string; code: string };
    expect(created.status).toBe('PENDING');
    expect(created.code).toMatch(/^ENG-RPT-\d{3}$/);

    const bank = (await (
      await h.api(`/documents/${documentId}/chapter-build/pitfalls`)
    ).json()) as {
      pitfalls: Array<{ code: string }>;
    };
    expect(bank.pitfalls.some((p) => p.code === created.code)).toBe(false);

    // A student is not an administrator.
    const admin = await h.api('/admin/pitfalls?status=PENDING');
    expect(admin.status).toBe(403);
  });
});
