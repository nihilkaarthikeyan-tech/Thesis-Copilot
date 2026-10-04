/**
 * One list of thesis languages for every picker (the Outline page offered 15 and the build page 9),
 * and adding the European ones must not switch on the checks written for English.
 */

import { describe, expect, it } from 'vitest';
import { LANGUAGES, languageSetting, latinScript } from '../src/profiles/index.js';

describe('LANGUAGES', () => {
  it('has every language either picker offered, once each', () => {
    const ids = LANGUAGES.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ['en', 'hi', 'bn', 'ta', 'te', 'mr', 'gu', 'kn', 'ml', 'pa', 'ur']) {
      expect(ids, id).toContain(id);
    }
    for (const id of ['fr', 'de', 'es', 'pt']) expect(ids, id).toContain(id);
  });

  it('keeps the English-only checks to English', () => {
    expect(latinScript('en')).toBe(true);
    expect(latinScript('en-GB')).toBe(true);
    expect(latinScript(null)).toBe(true);
    for (const id of ['fr', 'de', 'es', 'pt', 'ta', 'hi', 'ur', 'xx']) {
      expect(latinScript(id), id).toBe(false);
    }
  });

  it('still proofreads in a language it has no entry for', () => {
    expect(languageSetting('sw').proofread).toBe(true);
  });
});
