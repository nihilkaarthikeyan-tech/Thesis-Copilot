import { expect, test } from '@playwright/test';

/** The home page's scripted suggestion demo (ADR-0059 row 101): no model, no account. */
test('the hero demo plays, and stands still and complete for reduced motion', async ({
  browser,
}) => {
  const moving = await browser.newPage();
  await moving.goto('/');
  const demo = moving.getByTestId('hero-demo');
  // It starts by typing, so the suggestion is not there yet...
  await expect(demo).not.toContainText('Shakeel', { timeout: 3_000 });
  // ...and then streams in with its citation, and is kept.
  await expect(demo).toContainText('(Shakeel et al., 2023)', { timeout: 15_000 });
  await expect(demo).toContainText('kept', { timeout: 15_000 });
  await moving.close();

  const still = await browser.newPage({ reducedMotion: 'reduce' });
  await still.goto('/');
  await expect(still.getByTestId('hero-demo')).toContainText('(Shakeel et al., 2023)');
  await expect(still.getByTestId('hero-demo')).toContainText('kept');
  await still.close();
});
