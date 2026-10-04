/**
 * ADR-0061: the interface catalogues. English is the source; Hindi may lag behind it but may not
 * invent keys, drop a placeholder, or ship an empty string.
 */

import { describe, expect, it } from 'vitest';
import { en, type MessageKey } from '../src/i18n/en';
import { hi } from '../src/i18n/hi';
import {
  fill,
  LANGUAGES,
  parseLanguage,
  placeholders,
  splitTemplate,
  template,
  translate,
} from '../src/i18n/index';

const englishKeys = new Set(Object.keys(en));
const hindiEntries = Object.entries(hi) as Array<[MessageKey, string]>;

describe('the catalogues', () => {
  it('has no Hindi key that English lacks', () => {
    const orphans = hindiEntries.map(([key]) => key).filter((key) => !englishKeys.has(key));
    expect(orphans).toEqual([]);
  });

  it('has no empty value in either language', () => {
    const empty = [
      ...Object.entries(en).filter(([, value]) => value.trim() === ''),
      ...hindiEntries.filter(([, value]) => value.trim() === ''),
    ].map(([key]) => key);
    expect(empty).toEqual([]);
  });

  it('keeps every placeholder of the English source in the Hindi', () => {
    const mismatched = hindiEntries
      .filter(([key, value]) => placeholders(value).join() !== placeholders(en[key]).join())
      .map(([key]) => key);
    expect(mismatched).toEqual([]);
  });

  it('actually translates the screens it claims to', () => {
    // Beta, not empty: the editor's tabs and the Settings picker are the first things checked.
    expect(hi['editor.tab.chat']).toBeTruthy();
    expect(hi['settings.language']).toBeTruthy();
    expect(hindiEntries.length).toBeGreaterThan(300);
  });

  it('marks Hindi as beta in its own script', () => {
    expect(LANGUAGES.find((l) => l.id === 'hi')).toEqual({
      id: 'hi',
      name: 'हिन्दी (बीटा)',
      beta: true,
    });
  });
});

describe('translate', () => {
  it('reads English unchanged', () => {
    expect(translate('en', 'editor.history')).toBe('History');
    expect(translate('en', 'list.countMany', { count: 3 })).toBe('3 theses');
  });

  it('reads Hindi where there is a translation', () => {
    expect(translate('hi', 'editor.history')).toBe(hi['editor.history']);
    expect(translate('hi', 'editor.history')).not.toBe('History');
  });

  it('falls back to English for a key Hindi has not reached', () => {
    // `editor.usage` is deliberately untranslated: Assist and Draft are product names.
    expect(hi['editor.usage']).toBeUndefined();
    expect(translate('hi', 'editor.usage', { assist: '1/50', draft: '0/5' })).toBe(
      'Assist 1/50 · Draft 0/5',
    );
  });

  it('falls back to English for every key missing from Hindi', () => {
    const missing = (Object.keys(en) as MessageKey[]).filter((key) => hi[key] === undefined);
    for (const key of missing) expect(template('hi', key)).toBe(en[key]);
  });

  it('leaves an unknown placeholder visible instead of printing "undefined"', () => {
    expect(fill('Hello {name}', {})).toBe('Hello {name}');
  });

  it('treats anything but a known language as English', () => {
    expect(parseLanguage('hi')).toBe('hi');
    expect(parseLanguage('ta')).toBe('en');
    expect(parseLanguage(undefined)).toBe('en');
  });
});

describe('splitTemplate', () => {
  it('cuts a template at its slots, in the translation’s own order', () => {
    expect(splitTemplate('{tab} keeps it and {esc} dismisses it.')).toEqual([
      { slot: 'tab' },
      { text: ' keeps it and ' },
      { slot: 'esc' },
      { text: ' dismisses it.' },
    ]);
    expect(splitTemplate('no slots')).toEqual([{ text: 'no slots' }]);
  });
});
