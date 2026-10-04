/**
 * The citation locale — ADR-0058. Every expected string below is what citeproc produced when the
 * test was written (2026-10-04), read off the engine, not typed from a style guide.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CITATION_LOCALES,
  citationLocaleFor,
  FALLBACK_LOCALE,
  isCitationLocale,
  isLocaleLoadable,
} from '../src/locales.js';
import { previewStyle } from '../src/preview.js';
import { renderCitations } from '../src/render.js';
import { findStyle, registerStyleXml, STYLES_DIR } from '../src/styles.js';

/** A book chapter: an edition, an editor and an access date are where the locales differ. */
const CHAPTER = {
  id: 's1',
  cslJson: {
    type: 'chapter',
    title: 'A chapter',
    author: [
      { family: 'Kumar', given: 'Anil' },
      { family: 'Rao', given: 'B' },
    ],
    editor: [{ family: 'Ed', given: 'C' }],
    'container-title': 'Book',
    publisher: 'Pub',
    issued: { 'date-parts': [[2021, 3, 5]] },
    accessed: { 'date-parts': [[2024, 1, 2]] },
    edition: '2',
    URL: 'https://x.org/a',
    page: '1-9',
  },
};

function render(style: string, locale?: string | null) {
  const result = renderCitations({
    style,
    sources: [CHAPTER],
    citations: [{ key: 'k', sourceId: 's1' }],
    locale,
  });
  return { label: result.labels.k, entry: result.bibliography[0]?.text, locale: result.locale };
}

describe('the locales offered', () => {
  it('are each loadable by citeproc', () => {
    for (const locale of CITATION_LOCALES) expect(isLocaleLoadable(locale.id)).toBe(true);
  });

  it('do not include one citeproc would silently drop', () => {
    expect(isCitationLocale('en-IN')).toBe(false);
    expect(isLocaleLoadable('en-IN')).toBe(false);
  });
});

describe('rendering in a locale', () => {
  it('leaves the default exactly as it was: en-US terms', () => {
    const none = render('harvard');
    expect(none.locale).toBe('en-US');
    expect(none.entry).toBe(render('harvard', 'en-US').entry);
    expect(none.entry).toBe(
      'Kumar, A. and Rao, B. (2021) “A chapter,” in C. Ed (ed.) Book. 2nd ed. Pub, pp. 1–9. Available at: https://x.org/a (Accessed: January 2, 2024).',
    );
  });

  it('writes Harvard the British way in en-GB: single quotes, "edn", day-month-year', () => {
    const gb = render('harvard', 'en-GB');
    expect(gb.locale).toBe('en-GB');
    expect(gb.entry).toBe(
      'Kumar, A. and Rao, B. (2021) ‘A chapter’, in C. Ed (ed.) Book. 2nd edn. Pub, pp. 1–9. Available at: https://x.org/a (Accessed: 2 January 2024).',
    );
  });

  it('changes APA 7th\'s edition term, and not its "&"', () => {
    expect(render('apa', 'en-US').entry).toContain('(2nd ed., pp. 1–9)');
    expect(render('apa', 'en-GB').entry).toContain('(2nd edn, pp. 1–9)');
    expect(render('apa', 'en-GB').label).toBe('(Kumar & Rao, 2021)');
  });

  it('translates the terms for another language', () => {
    expect(render('harvard', 'de-DE').label).toBe('(Kumar und Rao, 2021)');
    expect(render('harvard', 'fr-FR').label).toBe('(Kumar et Rao, 2021)');
  });

  it("honours a journal style's own declared locale when the student has not chosen", () => {
    // British Journal of Clinical Psychology: APA rules, `en-GB` in the catalogue.
    expect(render('british-journal-of-clinical-psychology').locale).toBe('en-GB');
    expect(render('british-journal-of-clinical-psychology', 'en-US').locale).toBe('en-US');
  });

  it('renders a style whose declared locale citeproc lacks, instead of throwing', () => {
    // Before ADR-0058 a catalogue journal declaring pt-BR, da-DK or de-CH failed with a TypeError
    // inside citeproc. Its parent's XML is fetched in production; here the shipped Vancouver file
    // stands in for it through the same `registerStyleXml` the API uses, so no network is needed.
    const id = 'arquivos-brasileiros-de-cardiologia';
    const journal = findStyle(id);
    if (!journal?.xmlId) throw new Error(`${id} is not in the catalogue`);
    expect(journal.locale).toBe('pt-BR');
    registerStyleXml(journal.xmlId, readFileSync(join(STYLES_DIR, 'vancouver.csl'), 'utf8'));
    const result = renderCitations({
      style: id,
      sources: [CHAPTER],
      citations: [{ key: 'k', sourceId: 's1' }],
    });
    expect(result.locale).toBe(FALLBACK_LOCALE);
    expect(result.labels.k).toBe('(1)');
    expect(result.bibliography).toHaveLength(1);
  });
});

describe('the preview', () => {
  it('renders in the locale asked for and says which', () => {
    expect(previewStyle('harvard', undefined, 'en-GB').bibliography).toContain('‘An example');
    expect(previewStyle('harvard', undefined, 'en-GB').locale).toBe('en-GB');
    expect(previewStyle('harvard').bibliography).toContain('“An example');
    expect(previewStyle('harvard').locale).toBe('en-US');
  });
});

describe('the locale a document gets without a choice', () => {
  it("keeps the style's own for plain English and any English variant but en-GB / en-US", () => {
    expect(citationLocaleFor(null, 'en')).toBeNull();
    expect(citationLocaleFor(null, 'en-IN')).toBeNull();
    expect(citationLocaleFor(null, '')).toBeNull();
    expect(citationLocaleFor(undefined, undefined)).toBeNull();
  });

  it('follows an explicit en-GB or en-US document language', () => {
    expect(citationLocaleFor(null, 'en-GB')).toBe('en-GB');
    expect(citationLocaleFor(null, 'en-us')).toBe('en-US');
  });

  it('follows another language when exactly one locale serves it', () => {
    expect(citationLocaleFor(null, 'de')).toBe('de-DE');
    expect(citationLocaleFor(null, 'fr-CA')).toBe('fr-FR');
    expect(citationLocaleFor(null, 'hi')).toBeNull();
  });

  it("lets the student's choice win, and ignores one that is not offered", () => {
    expect(citationLocaleFor('en-GB', 'de')).toBe('en-GB');
    expect(citationLocaleFor('pt-BR', 'en')).toBeNull();
  });
});
