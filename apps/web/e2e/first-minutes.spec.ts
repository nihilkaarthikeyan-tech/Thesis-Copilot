/**
 * A new student's first minutes, after the Jenni journey study (docs/JENNI-STUDENT-JOURNEY.md
 * steps 0–3, docs/research/coverage-map.md rows 3 and 4): the topic box coaches the first message,
 * the start asks for a citation style, and a signed-in visitor to the home page is offered their
 * theses rather than a sign-up.
 */

import { expect, test } from '@playwright/test';
import { signInAs } from './_session.js';

test('the first message of the topic path has a strength meter that reacts as the student types', async ({
  page,
  request,
}) => {
  await signInAs(page, request);
  await page.goto('/app/new');
  await page.getByLabel(/Start from a topic/).check();
  await page.getByLabel('Working title').fill('Mangrove soil carbon');
  await page.getByRole('button', { name: 'Continue' }).click();

  const chat = page.getByTestId('path-a-chat');
  const input = chat.getByLabel('Your message');
  await expect(input).toHaveValue('Mangrove soil carbon', { timeout: 20_000 });
  const meter = chat.getByTestId('topic-meter');
  await expect(meter.getByTestId('topic-strength')).toHaveText('Weak topic');
  await expect(meter.getByTestId('topic-hints')).toContainText(
    'Add where or who: a place, population or dataset',
  );

  // Emptied, the box shows an example topic to follow.
  await input.fill('');
  await expect(meter.getByTestId('topic-strength')).toHaveText('Describe your topic');
  await expect(meter.getByTestId('topic-example')).toContainText('For example:');
  await expect(input).toHaveAttribute('placeholder', /^e\.g\. /);

  await input.fill('Effect of stand age on soil organic carbon in Pichavaram mangroves');
  await expect(meter.getByTestId('topic-strength')).toHaveText('Fair topic');
  await expect(meter.getByTestId('topic-hints')).toHaveText(
    'Add how: a method such as a survey, experiment, model or case study',
  );

  await input.fill(
    'Comparing soil organic carbon in restored and natural mangroves at Pichavaram, Tamil Nadu, using core sampling',
  );
  await expect(meter.getByTestId('topic-strength')).toHaveText('Strong topic');
  await expect(meter.getByTestId('topic-hints')).toHaveCount(0);

  // Sending is never blocked by the meter, and once sent the meter has done its job.
  await chat.getByRole('button', { name: 'Send' }).click();
  await expect(chat.locator('[data-role="assistant"]')).toHaveCount(1, { timeout: 20_000 });
  await expect(chat.getByTestId('topic-meter')).toHaveCount(0);
});
