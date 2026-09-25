import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * Making someone an admin from the admin screen (2026-09-25). The seeded superadmin opens a
 * student's page, hands out a role, sees it logged, and takes it back.
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com';

test('the superadmin changes a user’s role from their page, and it is logged', async ({
  page,
  playwright,
  request,
}) => {
  // The student gets a context of their own: a code cannot be requested for a second address on
  // a context that already holds a session, which is the right behaviour and not the test's.
  const studentEmail = freshEmail('role-student');
  const studentContext = await playwright.request.newContext();
  await establishSession(studentContext, studentEmail);
  await studentContext.dispose();
  const admin = await establishSession(request, ADMIN_EMAIL);
  const cookie = `${admin.cookieName}=${admin.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: admin.cookieName, value: admin.cookieValue, domain: 'localhost', path: '/' },
    ]);

  const list = (await (
    await request.get(`${API_URL}/api/v1/admin/users?limit=50`, { headers: { cookie } })
  ).json()) as { rows: Array<{ id: string; email: string }> };
  const student = list.rows.find((row) => row.email === studentEmail);
  if (!student) throw new Error('the new student is not on the first page of users');

  // The home page tells an admin where the admin screens are; a student never sees the link.
  await page.goto('/app');
  await expect(page.getByTestId('admin-link')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('admin-link')).toHaveAttribute('href', '/admin');

  // The site-wide AI budget is set from the admin home (2026-09-25), and the change is logged.
  await page.goto('/admin');
  const budgetInput = page.getByTestId('platform-budget-input');
  await expect(budgetInput).toBeVisible({ timeout: 30_000 });
  await budgetInput.fill('2000');
  await page.getByTestId('platform-budget-save').click();
  await expect(page.getByTestId('platform-budget-notice')).toContainText('set to ₹2000.00 a month');
  await expect(page.getByTestId('platform-budget-ceiling')).toContainText('₹2000.00 / month');
  // Back off, so the dev database is left as it was found.
  await budgetInput.fill('');
  await page.getByTestId('platform-budget-save').click();
  await expect(page.getByTestId('platform-budget-notice')).toContainText('switched off');

  await page.goto(`/admin/users/${student.id}`);
  const role = page.getByTestId('admin-role');
  await expect(role).toHaveValue('STUDENT', { timeout: 30_000 });

  await role.selectOption('INSTITUTION_ADMIN');
  await expect(page.getByTestId('admin-notice')).toContainText('Role set to INSTITUTION_ADMIN');
  await expect(role).toHaveValue('INSTITUTION_ADMIN');
  await expect(page.locator('main')).toContainText('ROLE_CHANGED');
  await page.screenshot({ path: 'test-results/admin-role.png', fullPage: true });

  await role.selectOption('STUDENT');
  await expect(page.getByTestId('admin-notice')).toContainText('Role set to STUDENT');
  await expect(role).toHaveValue('STUDENT');
});
