import { describe, expect, it } from 'vitest';
import { automaticLocaleLabel } from '../src/lib/citation-locale';

const locales = [
  { id: 'en-GB', label: 'English (UK)' },
  { id: 'en-US', label: 'English (US)' },
  { id: 'de-DE', label: 'German' },
];

describe('the automatic citation locale option', () => {
  it("names the style's own locale when nothing asks for one", () => {
    expect(automaticLocaleLabel({ locale: 'en-US', localeOverride: null, locales })).toBe(
      'Automatic: English (US), the style’s own',
    );
  });

  it('names the locale the thesis language chose', () => {
    expect(automaticLocaleLabel({ locale: 'de-DE', localeOverride: 'de-DE', locales })).toBe(
      'Automatic: German, from the thesis language',
    );
  });

  it('falls back to the id, then to the bare word', () => {
    expect(automaticLocaleLabel({ locale: 'pt-BR', localeOverride: null, locales })).toBe(
      'Automatic: pt-BR, the style’s own',
    );
    expect(automaticLocaleLabel({})).toBe('Automatic');
  });
});
