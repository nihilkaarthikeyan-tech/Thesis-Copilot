/**
 * Saved prompts — ADR-0019.
 *
 * Through HTTP against the real application. The two things worth proving are both about whose a
 * prompt is: a student sees and changes only their own, and someone else's is reported as absent
 * rather than forbidden (PRD §12.1), so an id cannot be probed for existence.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PROMPT_LIMITS } from '../src/modules/prompts/prompts.service.js';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;

type Prompt = { id: string; title: string; body: string; updatedAt: string };

/**
 * The harness sends a JSON content-type on every request, and Fastify refuses an empty JSON body,
 * so a DELETE carries `{}` here — as in `authz.spec.ts`. The web app's `api()` sets the header only
 * when there is a body, so the browser's bodiless DELETE never meets this.
 */
const DELETE = { method: 'DELETE', body: '{}' } as const;

const save = (title: string, body: string) =>
  h.api('/prompts', { method: 'POST', body: JSON.stringify({ title, body }) });

beforeAll(async () => {
  h = await startHarness('saved-prompts@example.edu');
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(async () => {
  await h.prisma.savedPrompt.deleteMany({});
});

describe('a student’s own prompts', () => {
  it('saves, lists alphabetically, edits and deletes', async () => {
    const first = await save('  Limitations ', 'What limitations do the authors admit?');
    expect(first.status).toBe(201);
    const limitations = (await first.json()) as Prompt;
    // Trimmed on the way in: a stray space would otherwise sort the prompt out of place.
    expect(limitations.title).toBe('Limitations');

    await save('Compare methods', 'How do the methods in these papers differ?');
    const listed = (await (await h.api('/prompts')).json()) as Prompt[];
    expect(listed.map((p) => p.title)).toEqual(['Compare methods', 'Limitations']);

    const edited = await h.api(`/prompts/${limitations.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        body: 'Which limitations do the authors admit, and which do they not?',
      }),
    });
    expect(edited.status).toBe(200);
    expect(((await edited.json()) as Prompt).body).toMatch(/^Which limitations/);

    const removed = await h.api(`/prompts/${limitations.id}`, DELETE);
    expect(removed.status).toBe(204);
    const after = (await (await h.api('/prompts')).json()) as Prompt[];
    expect(after.map((p) => p.title)).toEqual(['Compare methods']);
  });

  it('refuses an empty name or text, and text longer than a chat message', async () => {
    expect((await save('', 'x')).status).toBe(400);
    expect((await save('Name', '   ')).status).toBe(400);
    expect((await save('Name', 'x'.repeat(PROMPT_LIMITS.maxBody + 1))).status).toBe(400);
    const nothing = await h.api(`/prompts/${crypto.randomUUID()}`, {
      method: 'PATCH',
      body: JSON.stringify({}),
    });
    expect(nothing.status).toBe(400);
  });

  it('stops at the limit and says what to do about it', async () => {
    await h.prisma.savedPrompt.createMany({
      data: Array.from({ length: PROMPT_LIMITS.maxPrompts }, (_, i) => ({
        userId: h.userId,
        title: `Prompt ${i}`,
        body: 'text',
      })),
    });
    const refused = await save('One more', 'text');
    expect(refused.status).toBe(422);
    const problem = (await refused.json()) as { type: string; detail: string };
    expect(problem.type).toBe('PROMPT_LIMIT');
    expect(problem.detail).toContain('Delete one');
  });
});

describe('someone else’s prompt', () => {
  it('is absent: not listed, not editable, not deletable', async () => {
    const other = await h.prisma.user.create({
      data: { email: `other-${Date.now()}@example.edu`, emailVerified: true },
    });
    const theirs = await h.prisma.savedPrompt.create({
      data: { userId: other.id, title: 'Theirs', body: 'not yours' },
    });

    const listed = (await (await h.api('/prompts')).json()) as Prompt[];
    expect(listed).toEqual([]);

    const edit = await h.api(`/prompts/${theirs.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Mine now' }),
    });
    expect(edit.status).toBe(404);
    const remove = await h.api(`/prompts/${theirs.id}`, DELETE);
    expect(remove.status).toBe(404);

    const untouched = await h.prisma.savedPrompt.findUniqueOrThrow({ where: { id: theirs.id } });
    expect(untouched.title).toBe('Theirs');
  });

  it('a malformed id is a 404 too, not a 500', async () => {
    const response = await h.api('/prompts/not-a-uuid', DELETE);
    expect(response.status).toBe(404);
  });

  it('needs a session', async () => {
    const response = await h.api('/prompts', { headers: { cookie: '' } });
    expect(response.status).toBe(401);
  });
});
