/** ADR-0142: the signed, sign-in-free unsubscribe link. */

import { describe, expect, it } from 'vitest';
import { unsubscribeToken, verifyUnsubscribeToken } from '../src/index.js';

const SECRET = 'test-only-secret-0123456789abcdef0123456789';
const USER = '0190a000-0000-7000-8000-000000000002';

describe('unsubscribe token', () => {
  it('round-trips to the user it was made for', () => {
    const token = unsubscribeToken(SECRET, USER);
    expect(token.startsWith(`${USER}.`)).toBe(true);
    expect(verifyUnsubscribeToken(SECRET, token)).toBe(USER);
  });

  it('is URL-safe and has no colon', () => {
    expect(unsubscribeToken(SECRET, USER)).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it('refuses a token signed with another secret', () => {
    const token = unsubscribeToken('another-secret-0123456789abcdef0123456789', USER);
    expect(verifyUnsubscribeToken(SECRET, token)).toBeNull();
  });

  it('refuses a token whose user id was swapped for someone else', () => {
    const token = unsubscribeToken(SECRET, USER);
    const forged = token.replace(USER, '0190a000-0000-7000-8000-000000000009');
    expect(verifyUnsubscribeToken(SECRET, forged)).toBeNull();
  });

  it('refuses garbage without throwing', () => {
    for (const bad of ['', '.', 'abc', `${USER}.`, '.sig', `${USER}.x`, 'a.b.c']) {
      expect(verifyUnsubscribeToken(SECRET, bad)).toBeNull();
    }
  });
});
