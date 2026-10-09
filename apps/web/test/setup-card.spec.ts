/**
 * ADR-0145: the setup card's working parts — the folded Sources line, where the first sentence
 * goes, and when the first line counts as written.
 */

import { DEFAULT_SOURCE_PREFS } from '@tc/types';
import { Schema } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en';
import { bodyWords, firstLinePosition, sourcesLine } from '../src/lib/setup-card';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    heading: { group: 'block', content: 'text*', attrs: { level: { default: 1 } } },
    text: {},
  },
});
const h = (level: number, text: string) => schema.node('heading', { level }, [schema.text(text)]);
const p = (text = '') => schema.node('paragraph', null, text ? [schema.text(text)] : []);
const doc = (...blocks: ReturnType<typeof p>[]) => schema.node('doc', null, blocks);

const t = (key: keyof typeof en, values?: Record<string, string | number>) =>
  Object.entries(values ?? {}).reduce(
    (text, [name, value]) => text.replace(`{${name}}`, String(value)),
    en[key] as string,
  );

describe('the setup card (ADR-0145)', () => {
  it('folds the source settings into one line', () => {
    expect(sourcesLine(DEFAULT_SOURCE_PREFS, 'APA 7', t)).toBe(
      'APA 7 · web and library · all years · any journal · preprints',
    );
    expect(
      sourcesLine(
        { ...DEFAULT_SOURCE_PREFS, librarySearch: false, yearFrom: 2019, preprints: false },
        null,
        t,
      ),
    ).toBe('web only · 2019–now · any journal · no preprints');
  });

  it('puts the first sentence under the first section, else under the chapter title', () => {
    const planned = doc(h(1, 'Introduction'), h(2, 'Problem statement'), p(), h(2, 'Aims'), p());
    // Inside the empty line after "Problem statement".
    const first = planned.child(0).nodeSize + planned.child(1).nodeSize + 1;
    expect(firstLinePosition(planned)).toBe(first);
    const blank = doc(h(1, 'Chapter 1'), p());
    expect(firstLinePosition(blank)).toBe(blank.child(0).nodeSize + 1);
    expect(firstLinePosition(doc(h(1, 'Chapter 1'), p('Written.')))).toBeNull();
  });

  it('counts only the words outside headings', () => {
    expect(bodyWords(doc(h(1, 'Chapter one title'), p()))).toBe(0);
    expect(bodyWords(doc(h(1, 'Chapter 1'), p('Rooftop solar spreads slowly.')))).toBe(4);
  });
});
