import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * The superadmin's controls, in a browser (2026-09-29, the owner's approved design): extra
 * allowance, suspend and unsuspend, the read-only thesis view with its banner, deleting a thesis
 * behind a typed confirmation — and the student deleting a thesis of their own from the list.
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com';

test('the superadmin manages a student and their thesis from the user page', async ({
  page,
  playwright,
  request,
}) => {
  const studentEmail = freshEmail('controls');
  const studentContext = await playwright.request.newContext();
  const student = await establishSession(studentContext, studentEmail);
  const studentCookie = `${student.cookieName}=${student.cookieValue}`;
  const created = await studentContext.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie: studentCookie },
    data: { title: 'Rooftop solar adoption in Karnataka', entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };
  const chapter = (await (
    await studentContext.get(`${API_URL}/api/v1/chapters/${doc.firstChapterId}`, {
      headers: { cookie: studentCookie },
    })
  ).json()) as { version: number };
  await studentContext.put(`${API_URL}/api/v1/chapters/${doc.firstChapterId}`, {
    headers: { cookie: studentCookie },
    data: {
      baseVersion: chapter.version,
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Households decide one roof at a time.' }],
          },
        ],
      },
    },
  });
  await studentContext.dispose();

  const admin = await establishSession(request, ADMIN_EMAIL);
  await page
    .context()
    .addCookies([
      { name: admin.cookieName, value: admin.cookieValue, domain: 'localhost', path: '/' },
    ]);

  // Found by search, opened from the list.
  await page.goto(`/admin/users?q=${encodeURIComponent(studentEmail)}`);
  await page.getByRole('link', { name: studentEmail }).click();
  await expect(page.getByTestId('admin-open-allowance')).toBeVisible({ timeout: 30_000 });

  // Extra allowance: +5 autocomplete, with a reason, shows in the month's usage.
  await page.getByTestId('admin-open-allowance').click();
  await page.getByTestId('allowance-ASSIST').fill('5');
  await page.getByTestId('allowance-reason').fill('Submission next week');
  await page.getByTestId('allowance-submit').click();
  await expect(page.getByTestId('admin-notice')).toContainText('+5 autocomplete');
  await expect(page.getByTestId('user-usage')).toContainText('(+5)');
  await expect(page.getByTestId('user-events')).toContainText('Extra allowance given');

  // Suspend asks for a reason; the status says so; Unsuspend puts it back.
  await page.getByTestId('admin-open-suspend').click();
  await expect(page.getByTestId('admin-suspend-dialog-submit')).toBeDisabled();
  await page.getByTestId('admin-suspend-dialog-reason').fill('Checking the suspend flow');
  await page.getByTestId('admin-suspend-dialog-submit').click();
  await expect(page.getByTestId('admin-notice')).toContainText('Suspended');
  await expect(page.getByTestId('admin-unsuspend')).toBeVisible();
  await page.getByTestId('admin-unsuspend').click();
  await expect(page.getByTestId('admin-notice')).toContainText('Unsuspended');

  // Read-only view: the banner says it is logged, the text is there, nothing is editable.
  await page.getByTestId('admin-open-thesis').click();
  await expect(page.getByTestId('admin-read-only-banner')).toContainText('This visit is logged');
  await expect(page.getByTestId('admin-read-only-chapter')).toContainText(
    'Households decide one roof at a time.',
  );
  await expect(page.locator('[contenteditable="true"]')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/admin-read-only.png', fullPage: true });

  // Delete behind the typed first word, with a reason sent to the student.
  await page.goBack();
  await expect(page.getByTestId('admin-user-theses')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('admin-user-theses').getByRole('button', { name: 'Delete' }).click();
  const submit = page.getByTestId('admin-delete-thesis-dialog-submit');
  await page.getByTestId('admin-delete-thesis-dialog-reason').fill('Test clean-up');
  await expect(submit).toBeDisabled();
  await page.getByTestId('admin-delete-thesis-dialog-confirm').fill('Rooftop');
  await submit.click();
  await expect(page.getByTestId('admin-notice')).toContainText('was deleted');
  await expect(page.getByTestId('admin-user-theses')).toHaveCount(0);
});

test('a student deletes a thesis of their own from the list, after a warning', async ({
  page,
  request,
}) => {
  const session = await establishSession(request, freshEmail('own-delete'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: 'A thesis to throw away', entryPath: 'A_TOPIC' },
  });
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  await page.goto('/app');
  await expect(page.getByText('A thesis to throw away')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('delete-thesis').click();
  const dialog = page.getByTestId('delete-thesis-dialog');
  await expect(dialog).toContainText('removed for good');
  await expect(dialog.getByRole('link', { name: 'Export .docx first' })).toBeVisible();
  await page.getByTestId('delete-thesis-confirm').click();
  await expect(page.getByText('A thesis to throw away')).toHaveCount(0);
  await expect(page.getByText('No theses yet')).toBeVisible();
});
