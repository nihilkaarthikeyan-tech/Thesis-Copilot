import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * The three chat scopes — ADR-0016.
 *
 * `library` was the only one that existed and is covered elsewhere. The other two were built,
 * typechecked and unit tested, and had never been driven on a screen, which is where the two
 * things that matter about them actually live:
 *
 *   - **`document` answers from the student's own draft and nothing in it is citable.** Chapter
 *     passages carry no `sourceId`, which is what makes `postProcessChat` strip any citation the
 *     model produces against them. A claim about your own thesis is not a claim with a source.
 *   - **`web` is not a conversation.** It searches the literature, shows real papers and offers
 *     to add them; it does not answer. That is ADR-0016 option (c), and the reason it makes no
 *     model call and costs no cap unit.
 */

const WRITTEN =
  'Adoption of drip irrigation in the two surveyed districts rose from twelve per cent in 2015 to thirty-one per cent in 2022. The subsidy was announced in 2017.';

test.describe('chat scopes', () => {
  test.setTimeout(180_000);

  test('the thesis scope answers from the draft, and offers nothing to cite', async ({
    page,
    request,
  }) => {
    const session = await establishSession(request, freshEmail('scope-doc'));
    const cookie = `${session.cookieName}=${session.cookieValue}`;
    await page
      .context()
      .addCookies([
        { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
      ]);

    const created = await request.post(`${API_URL}/api/v1/documents`, {
      headers: { cookie },
      data: { title: `Scope doc ${Date.now()}`, entryPath: 'A_TOPIC' },
    });
    const doc = (await created.json()) as { id: string; firstChapterId: string };

    await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
    await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
    await page.locator('.thesis-editor p').first().click();
    await page.keyboard.type(WRITTEN);
    await page.keyboard.press('Control+s');
    await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 20_000 });

    await page.getByRole('tab', { name: 'chat', exact: true }).click();
    const panel = page.getByTestId('chat-panel');
    await expect(panel).toBeVisible();

    await panel.getByTestId('chat-scope-document').click();
    await expect(panel).toContainText('Nothing here is citable');

    await panel.getByRole('textbox').fill('What have I written about the subsidy?');
    await panel.getByRole('button', { name: 'Ask', exact: true }).click();

    const answer = panel.locator('[data-role=assistant]');
    await expect(answer).toHaveCount(1, { timeout: 120_000 });

    // Nothing in the answer is offered as a source, whatever it says: chapter passages carry no
    // `sourceId`, so `postProcessChat` strips every citation the model produces against them.
    // This is the invariant the scope exists for and the only one that is ours to guarantee.
    // Citation buttons only: every answer also offers "Add to document" and "Copy" (2026-10-04).
    await expect(
      answer.locator(
        'button:not([data-testid="chat-add-to-document"]):not([data-testid="chat-copy"])',
      ),
    ).toHaveCount(0);

    // Deliberately not asserted: that the answer actually contains what the draft says. This run
    // is what found that A.4 refuses in the wrong words here — "Your library does not contain
    // enough on this" for a passage sitting in the chapter. A.4 is a verbatim copy of the PRD's
    // appendix and prompts are content, not code (§0.3 rule 6), so the change is the owner's:
    // `docs/PENDING.md`, "A.4 refuses in the wrong words". Assert it when that lands.

    // What is already fixed is the advice underneath, which is ours and was wrong: it told the
    // student to add sources to a library this scope never reads.
    await expect(panel).not.toContainText('Add sources from the Discover tab');
  });

  test('find-papers returns real papers and does not answer the question', async ({
    page,
    request,
  }) => {
    const session = await establishSession(request, freshEmail('scope-web'));
    const cookie = `${session.cookieName}=${session.cookieValue}`;
    await page
      .context()
      .addCookies([
        { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
      ]);

    const created = await request.post(`${API_URL}/api/v1/documents`, {
      headers: { cookie },
      data: { title: `Scope web ${Date.now()}`, entryPath: 'A_TOPIC' },
    });
    const doc = (await created.json()) as { id: string; firstChapterId: string };

    await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
    await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('tab', { name: 'chat', exact: true }).click();

    const panel = page.getByTestId('chat-panel');
    await panel.getByTestId('chat-scope-web').click();
    await expect(panel).toContainText('It does not answer the question');

    await panel.getByRole('textbox').fill('drip irrigation adoption smallholder farmers');
    await panel.getByRole('button', { name: 'Ask', exact: true }).click();

    // Real records from OpenAlex, not prose.
    const results = panel.getByTestId('web-results');
    await expect(results).toBeVisible({ timeout: 60_000 });
    await expect(panel.getByTestId('web-add').first()).toBeVisible({ timeout: 60_000 });
    // Nothing joined the conversation: this scope produces no assistant turn at all.
    await expect(panel.locator('[data-role=assistant]')).toHaveCount(0);
  });
});
