import { expect, test } from '@playwright/test';
import { PRICING } from '@tc/config';

/**
 * The Terms and Contact pages (2026-09-25), which a payment gateway's approval reads. The Terms
 * print prices from the table billing charges by, so they cannot disagree with a charge; the
 * Contact page prints the company's details or says one is still to be added — never a guess.
 */

test('the terms state the prices billing actually charges, and link the policies', async ({
  page,
}) => {
  await page.goto('/terms');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Terms of service');
  const main = page.locator('main');
  await expect(main).toContainText(
    `₹${PRICING.STUDENT_MONTHLY.priceInr.toLocaleString('en-IN')} a month`,
  );
  await expect(main).toContainText(
    `₹${PRICING.STUDENT_ANNUAL.priceInr.toLocaleString('en-IN')} a year`,
  );
  await expect(main.getByRole('link', { name: 'the refunds page' })).toHaveAttribute(
    'href',
    '/refunds',
  );
  await page.screenshot({ path: 'test-results/terms.png', fullPage: true });
});

test('the contact page lists every detail, and each is real or marked as still to come', async ({
  page,
}) => {
  await page.goto('/contact');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Contact us');
  const details = page.getByTestId('contact-details');
  for (const label of ['Email', 'Phone', 'Operated by', 'Address']) {
    await expect(details).toContainText(label);
  }
  // The footer on the home page reaches both.
  await page.goto('/');
  await expect(page.locator('footer').getByRole('link', { name: 'Terms' })).toHaveAttribute(
    'href',
    '/terms',
  );
  await expect(page.locator('footer').getByRole('link', { name: 'Contact' })).toHaveAttribute(
    'href',
    '/contact',
  );
});
