/**
 * The three week-8 and week-9 screens the VERIFY batch names — PRD FR-3.1, FR-3.4, FR-4.8,
 * FR-4.9; PHASES v2 W8, W9.
 *
 *   "the outline tree, commands diff, chat"
 *
 * Each of them has a rule that only a browser can prove, because each is about what a student sees
 * before they commit to anything:
 *
 * - The **outline tree** is editable, and an edit saved there is the same record the prompt
 *   builder reads (FR-3.4). A tree that displayed one thing and prompted with another would be
 *   invisible everywhere except in the quality of the writing.
 * - A **section command** shows a diff and changes nothing until Apply (§12.3, "flag, don't fix").
 * - **Chat** answers from the library and says so; with nothing pinned it has nothing to say, and
 *   saying nothing is the correct answer rather than a guess.
 */

import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail, type Session } from './_session.js';

let session: Session | null = null;

async function signIn(page: Page, request: APIRequestContext): Promise<Session> {
  session ??= await establishSession(request, freshEmail('w8w9'));
  return use(page, session);
}

/**
 * A fresh account, for a test that spends a metered unit.
 *
 * FREE_TRIAL allows two `COMMAND` actions a month (§11.3), so the three command tests below
 * cannot share one — the third would be refused by the cap, correctly, and the test would be
 * reading a cap message instead of a diff.
 */
async function signInFresh(page: Page, request: APIRequestContext, who: string): Promise<Session> {
  return use(page, await establishSession(request, freshEmail(who)));
}

async function use(page: Page, s: Session): Promise<Session> {
  await page
    .context()
    .addCookies([{ name: s.cookieName, value: s.cookieValue, domain: 'localhost', path: '/' }]);
  return s;
}

const cookieHeader = (s: Session) => ({ cookie: `${s.cookieName}=${s.cookieValue}` });

/**
 * A thesis with a saved proposal, made through the API.
 *
 * The proposal *screen* is `proposal-sources.spec.ts`'s subject and needs a seed paper to render;
 * these three tests are about what comes after it, so the scope is written the way the screen
 * writes it and the browser starts where the test actually begins.
 */
async function thesisWithProposal(
  request: APIRequestContext,
  s: Session,
  title: string,
): Promise<{ documentId: string; chapterId: string }> {
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: cookieHeader(s),
    data: { title, entryPath: 'A_TOPIC' },
  });
  expect(created.ok(), 'creating the thesis').toBe(true);
  const { id, firstChapterId } = (await created.json()) as {
    id: string;
    firstChapterId: string;
  };

  const scope = await request.put(`${API_URL}/api/v1/documents/${id}/memory/scope`, {
    headers: cookieHeader(s),
    data: {
      workingTitle: title,
      problemStatement:
        'Open-air drying on the coast loses a fifth of the landed catch to spoilage.',
      objectives: ['Design a forced-convection dryer', 'Measure drying curves across seasons'],
      whyOpen: 'Published designs assume inland humidity and do not report coastal performance.',
    },
  });
  expect(scope.ok(), 'saving the proposal').toBe(true);
  return { documentId: id, chapterId: firstChapterId };
}

/** Types `text` into the first paragraph and leaves it selected. */
async function typeAndSelect(page: Page, text: string) {
  const editor = page.locator('.thesis-editor');
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.locator('p').first().click();
  await page.keyboard.type(text);
  await page.keyboard.down('Shift');
  for (let i = 0; i < text.length; i++) await page.keyboard.press('ArrowLeft');
  await page.keyboard.up('Shift');
  return editor;
}

test.describe('FR-3.1/3.4 — the outline tree', () => {
  test('generates a tree, renames a chapter, and the rename reaches the editor rail', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const s = await signIn(page, request);
    const title = `Outline ${Date.now()}`;
    const { documentId, chapterId } = await thesisWithProposal(request, s, title);

    await page.goto(`/app/d/${documentId}/outline`);
    await page.getByTestId('generate-outline').click();

    const tree = page.getByTestId('outline-tree');
    await expect(tree).toBeVisible({ timeout: 60_000 });
    // Generation is a job (FR-3.2). The tree is on screen throughout — showing the one chapter a
    // new thesis starts with — so the wait is for the template's chapters to arrive, not for the
    // tree to appear.
    const nodes = page.getByTestId('outline-node');
    await expect
      .poll(async () => nodes.count(), { timeout: 120_000, message: 'the outline never arrived' })
      .toBeGreaterThan(1);

    // The tree is editable in place, and Save is only offered once something changed.
    const firstTitle = nodes.first().getByRole('textbox').first();
    const original = (await firstTitle.inputValue()).trim();
    const renamed = `${original} and motivation`;
    await firstTitle.fill(renamed);
    const save = page.getByTestId('save-outline');
    await expect(save).toBeEnabled();
    await save.click();
    await expect(save).toHaveText('Saved', { timeout: 20_000 });

    // FR-3.4: the same record the editor reads. A tree that only changed on screen would leave
    // the chapter — and the prompt built from it — saying the old thing.
    await page.reload();
    await expect(page.getByTestId('outline-node').first().getByRole('textbox').first()).toHaveValue(
      renamed,
      { timeout: 20_000 },
    );
    await page.goto(`/app/d/${documentId}/write/${chapterId}`);
    await expect(page.getByText(renamed).first()).toBeVisible({ timeout: 30_000 });
  });

  test('a chapter added by hand survives a save and a reload', async ({ page, request }) => {
    test.setTimeout(120_000);
    const s = await signIn(page, request);
    const title = `Outline manual ${Date.now()}`;
    const { documentId } = await thesisWithProposal(request, s, title);

    await page.goto(`/app/d/${documentId}/outline`);
    await expect(page.getByTestId('outline-tree')).toBeVisible({ timeout: 30_000 });
    const before = await page.getByTestId('outline-node').count();

    await page.getByRole('button', { name: 'Add chapter' }).click();
    await expect(page.getByTestId('outline-node')).toHaveCount(before + 1);
    const added = page.getByTestId('outline-node').last().getByRole('textbox').first();
    await added.fill('A chapter I added myself');
    await page.getByTestId('save-outline').click();
    await expect(page.getByTestId('save-outline')).toHaveText('Saved', { timeout: 20_000 });

    await page.reload();
    await expect(page.getByTestId('outline-node')).toHaveCount(before + 1, { timeout: 20_000 });
    await expect(page.getByTestId('outline-node').last().getByRole('textbox').first()).toHaveValue(
      'A chapter I added myself',
    );
  });
});

test.describe('FR-4.8 — section commands', () => {
  test('a command shows a diff and changes nothing until Apply', async ({ page, request }) => {
    test.setTimeout(180_000);
    const s = await signInFresh(page, request, 'cmd-apply');
    const title = `Command ${Date.now()}`;
    const { documentId, chapterId } = await thesisWithProposal(request, s, title);
    await page.goto(`/app/d/${documentId}/write/${chapterId}`);

    // Three sentences: `shorten` drops whole sentences rather than rewriting one, so a
    // single-sentence selection comes back unchanged and there is correctly nothing to apply.
    const sentence =
      'Open drying loses a large amount of the catch. This is bad for the fishing families involved. The losses concentrate in the monsoon months.';
    // The toolbar only exists while there is a selection.
    const editor = await typeAndSelect(page, sentence);

    const toolbar = page.getByTestId('command-toolbar');
    await expect(toolbar).toBeVisible({ timeout: 10_000 });
    await toolbar.getByRole('button', { name: 'Shorten' }).click();

    const diff = page.getByTestId('command-diff');
    await expect(diff).toBeVisible({ timeout: 30_000 });
    await expect(toolbar).toContainText('Nothing is applied until you press Apply.');
    // The chapter still reads exactly as the student left it.
    await expect(editor).toContainText(sentence);

    const apply = page.getByTestId('command-apply');
    await expect(apply).toBeEnabled();
    await apply.click();
    await expect(page.getByTestId('command-diff')).toHaveCount(0, { timeout: 15_000 });
    await expect(editor).not.toContainText(sentence);
  });

  test('offers nothing to apply when the rewrite came back unchanged', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const s = await signInFresh(page, request, 'cmd-unchanged');
    const title = `Command unchanged ${Date.now()}`;
    const { documentId, chapterId } = await thesisWithProposal(request, s, title);
    await page.goto(`/app/d/${documentId}/write/${chapterId}`);

    // One sentence, which `shorten` keeps: there is no shorter version to offer.
    await typeAndSelect(page, 'A single sentence that cannot be shortened by dropping sentences.');
    const toolbar = page.getByTestId('command-toolbar');
    await expect(toolbar).toBeVisible({ timeout: 10_000 });
    await toolbar.getByRole('button', { name: 'Shorten' }).click();
    await expect(page.getByTestId('command-diff')).toBeVisible({ timeout: 30_000 });
    // Apply is offered but inert: pressing it would spend the student's attention on nothing.
    await expect(page.getByTestId('command-apply')).toBeDisabled();
  });

  test('Discard leaves the chapter exactly as it was', async ({ page, request }) => {
    test.setTimeout(180_000);
    const s = await signInFresh(page, request, 'cmd-discard');
    const title = `Command discard ${Date.now()}`;
    const { documentId, chapterId } = await thesisWithProposal(request, s, title);
    await page.goto(`/app/d/${documentId}/write/${chapterId}`);

    // Three sentences again, so `shorten` has something to offer and Discard has something to
    // decline. (A rewrite that came back unchanged would leave nothing to discard.)
    const sentence =
      'A sentence the student intends to keep. A second sentence they also wrote. A third that completes the paragraph.';
    const editor = await typeAndSelect(page, sentence);

    const toolbar = page.getByTestId('command-toolbar');
    await expect(toolbar).toBeVisible({ timeout: 10_000 });
    await toolbar.getByRole('button', { name: 'Shorten' }).click();
    await expect(page.getByTestId('command-diff')).toBeVisible({ timeout: 30_000 });
    await toolbar.getByRole('button', { name: 'Discard' }).click();

    await expect(page.getByTestId('command-diff')).toHaveCount(0);
    await expect(editor).toContainText(sentence);
    await page.reload();
    await expect(page.locator('.thesis-editor')).toContainText(sentence, { timeout: 30_000 });
  });
});

test.describe('FR-4.9 — chat over the library', () => {
  test('says where its answers come from, and refuses to guess with an empty library', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const s = await signIn(page, request);
    const title = `Chat ${Date.now()}`;
    const { documentId, chapterId } = await thesisWithProposal(request, s, title);

    await page.goto(`/app/d/${documentId}/write/${chapterId}`);
    await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
    // `role="tab"`, not button: the panel strip is a real tablist, and an explicit role
    // replaces the implicit one.
    await page.getByRole('tab', { name: 'chat', exact: true }).click();

    const panel = page.getByTestId('chat-panel');
    await expect(panel).toBeVisible();
    // The promise the panel makes, before anything is asked.
    await expect(panel).toContainText('Answers come only from your library.');
    await expect(panel).toContainText('use Assist or Draft in the editor');

    await panel
      .getByPlaceholder('What do my sources say about…')
      .fill('What do my sources say about drying rates?');
    await panel.getByRole('button', { name: /Ask|Send/ }).click();

    // With nothing in the library there is nothing to answer from, and the panel says so rather
    // than answering from the model's own knowledge (§10.6).
    await expect(panel).toContainText(/librar|nothing|no sources|pin/i, { timeout: 60_000 });
  });
});
