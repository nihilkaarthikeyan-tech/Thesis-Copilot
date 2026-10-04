/**
 * ADR-0061 through the real HTTP path: the interface language is kept in the account's settings,
 * accepts only the languages the web app has, and leaves every other setting alone.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;

beforeAll(async () => {
  h = await startHarness('interface-language@example.com');
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

describe('the interface language setting', () => {
  it('is absent until chosen, then kept', async () => {
    const initial = (await (await h.api('/settings')).json()) as { interfaceLanguage?: string };
    expect(initial.interfaceLanguage).toBeUndefined();

    const put = await h.api('/settings', {
      method: 'PUT',
      body: JSON.stringify({ interfaceLanguage: 'hi' }),
    });
    expect(put.status).toBe(200);

    const after = (await (await h.api('/settings')).json()) as {
      interfaceLanguage?: string;
      autoCite: boolean;
    };
    expect(after.interfaceLanguage).toBe('hi');
    // Saving the language does not disturb the defaults of the other settings.
    expect(after.autoCite).toBe(true);
  });

  it('refuses a language the interface does not have', async () => {
    const put = await h.api('/settings', {
      method: 'PUT',
      body: JSON.stringify({ interfaceLanguage: 'ta' }),
    });
    expect(put.status).toBe(400);
  });
});
