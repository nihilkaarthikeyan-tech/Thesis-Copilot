/**
 * Jenni build plan R10 (ADR-0097) — a section's note, edited in the editor's Sections panel.
 *
 * Pinned:
 * - a note for a planned section updates that section (found by its heading's words, numbering
 *   and punctuation aside), and nothing else in the outline changes;
 * - a note for a heading the student typed adds it as a section of that chapter, which Assist
 *   then reads (`sectionUnderHeading`);
 * - a chapter that is not in the outline is told so; another student's thesis is not found.
 */

import { findOutlineNode, readOutline, scopeWithSection, sectionUnderHeading } from '@tc/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let documentId: string;
let chapterId: string;
let unplannedChapterId: string;

const OUTLINE = [
  {
    id: 'ch1-intro',
    title: 'Introduction',
    scopeNote: 'Why night-time heat matters for outdoor workers.',
    children: [
      { id: 'ch1-sec1', title: 'Problem statement', scopeNote: 'State the problem.', children: [] },
      { id: 'ch1-sec2', title: 'Objectives', scopeNote: 'List the objectives.', children: [] },
    ],
  },
  { id: 'ch2-lit', title: 'Literature review', scopeNote: 'What is known.', children: [] },
];

async function put(body: Record<string, unknown>, id = documentId): Promise<Response> {
  return h.api(`/documents/${id}/outline/section-note`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

async function outline() {
  const memory = await h.prisma.documentMemory.findUnique({
    where: { documentId },
    select: { outline: true },
  });
  return readOutline(memory?.outline);
}

beforeAll(async () => {
  h = await startHarness('section-notes@example.com');
  const document = await h.prisma.document.create({
    data: {
      ownerId: h.userId,
      title: 'Night-time heat and outdoor workers in Chennai',
      entryPath: 'A_TOPIC',
      memory: { create: { outline: OUTLINE as never, scope: {}, glossary: {} } },
    },
  });
  documentId = document.id;
  const chapter = await h.prisma.chapter.create({
    data: {
      documentId,
      outlineNodeId: 'ch1-intro',
      title: 'Introduction',
      order: 1,
      content: { type: 'doc', content: [] },
    },
  });
  chapterId = chapter.id;
  const loose = await h.prisma.chapter.create({
    data: {
      documentId,
      outlineNodeId: 'not-in-outline',
      title: 'Loose chapter',
      order: 3,
      content: { type: 'doc', content: [] },
    },
  });
  unplannedChapterId = loose.id;
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

describe("a section's note from the Sections panel", () => {
  it('updates the planned section its heading names, and nothing else', async () => {
    const res = await put({
      chapterId,
      title: '1.1 Problem statement',
      scopeNote: '  Establish that heat persists at night in Chennai.  ',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: 'ch1-sec1', created: false });
    const tree = await outline();
    expect(tree[0]?.children[0]?.scopeNote).toBe(
      'Establish that heat persists at night in Chennai.',
    );
    expect(tree[0]?.children[1]?.scopeNote).toBe('List the objectives.');
    expect(tree[1]?.scopeNote).toBe('What is known.');
  });

  it('adds a heading the student typed as a section, and Assist reads its note', async () => {
    const res = await put({
      chapterId,
      title: 'Sleep and recovery',
      scopeNote: 'Show how hot nights cut sleep and recovery.',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; created: boolean };
    expect(body.created).toBe(true);
    expect(body.id).toBe('ch1-intro-sleep-and-recovery');

    const tree = await outline();
    const section = sectionUnderHeading(findOutlineNode(tree, 'ch1-intro'), 'Sleep and recovery');
    expect(scopeWithSection('Chapter note.', section)).toContain(
      'This section, "Sleep and recovery": Show how hot nights cut sleep and recovery.',
    );

    // Saying it again updates the same section rather than adding a second.
    await put({ chapterId, title: 'Sleep and recovery', scopeNote: 'Shorter.' });
    const again = await outline();
    expect(again[0]?.children.filter((c) => c.title === 'Sleep and recovery')).toHaveLength(1);
    expect(again[0]?.children.at(-1)?.scopeNote).toBe('Shorter.');
  });

  it('tells a chapter that is not in the outline, and finds no other thesis', async () => {
    const loose = await put({ chapterId: unplannedChapterId, title: 'Anything', scopeNote: 'x' });
    expect(loose.status).toBe(400);
    const stranger = await h.prisma.user.create({
      data: { email: 'stranger-notes@example.com', name: 'Stranger' },
    });
    const theirs = await h.prisma.document.create({
      data: { ownerId: stranger.id, title: 'Theirs', entryPath: 'A_TOPIC' },
    });
    expect((await put({ chapterId, title: 'Objectives', scopeNote: 'x' }, theirs.id)).status).toBe(
      404,
    );
  });
});
