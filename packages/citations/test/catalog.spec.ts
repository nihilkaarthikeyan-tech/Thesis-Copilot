/**
 * Ten thousand styles, searchable — and the ones that must not be choosable.
 *
 * The catalogue is real: `styles/catalog.json.gz` built from the CSL repository at a pinned commit.
 * These run against it, so a rebuilt catalogue that loses the journals a student is most likely to
 * search for, or starts offering footnote styles as choosable, fails here.
 */

import { describe, expect, it } from 'vitest';
import { catalogSource, catalogStyle, searchCatalog, selectableCount } from '../src/catalog.js';
import {
  findStyle,
  isKnownStyle,
  needsStyleXml,
  registerStyleXml,
  resolveStyle,
  STYLES_DIR,
  StyleNotLoadedError,
  styleXml,
} from '../src/styles.js';

describe('the catalogue', () => {
  it('holds the whole CSL repository, at a named commit', () => {
    const source = catalogSource(STYLES_DIR);
    expect(source.count).toBeGreaterThan(10_000);
    expect(source.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(source.licence).toContain('CC BY-SA');
  });

  it('offers more than ten thousand styles a student can choose', () => {
    expect(selectableCount(STYLES_DIR)).toBeGreaterThan(10_000);
  });

  it('knows a journal style borrows its parent’s rules', () => {
    const style = catalogStyle('journal-of-cleaner-production', STYLES_DIR);
    expect(style?.title).toBe('Journal of Cleaner Production');
    expect(style?.parent).toBe('elsevier-harvard');
    expect(style?.xmlId).toBe('elsevier-harvard');
    expect(style?.family).toBe('author-date');
    expect(style?.selectable).toBe(true);
  });

  it('lists footnote styles, and lets them be chosen now the editor has footnotes', () => {
    // ADR-0029 reverses ADR-0018's refusal: citations in a note style become footnotes.
    const notes =
      catalogStyle('chicago-notes-bibliography', STYLES_DIR) ??
      catalogStyle('chicago-fullnote-bibliography', STYLES_DIR);
    expect(notes?.family).toBe('note');
    expect(notes?.selectable).toBe(true);
  });
});

describe('searching it', () => {
  it('finds a journal by the words a supervisor would say', () => {
    const results = searchCatalog('cleaner production', STYLES_DIR);
    expect(results.map((r) => r.id)).toContain('journal-of-cleaner-production');
  });

  it('puts an exact match first', () => {
    expect(searchCatalog('nature', STYLES_DIR)[0]?.id).toBe('nature');
  });

  it('puts an independent style before the journals that borrow it', () => {
    // "ieee" and "springer" match both kinds equally well; the independents come first.
    for (const query of ['ieee', 'springer']) {
      const results = searchCatalog(query, STYLES_DIR, 60);
      const firstDependent = results.findIndex((r) => r.parent);
      const lastIndependent = results.map((r) => !r.parent).lastIndexOf(true);
      expect(firstDependent, query).toBeGreaterThan(0);
      expect(lastIndependent, query).toBeLessThan(firstDependent);
    }
  });

  it('still lets an exact journal name beat a style that merely starts with the word', () => {
    // The journal called "Energy" is what someone typing "energy" is looking for.
    const [first] = searchCatalog('energy', STYLES_DIR);
    expect(first?.title).toBe('Energy');
  });

  it('ignores case and accents', () => {
    const plain = searchCatalog('universite', STYLES_DIR, 10).map((r) => r.id);
    const accented = searchCatalog('Université', STYLES_DIR, 10).map((r) => r.id);
    expect(accented).toEqual(plain);
    expect(plain.length).toBeGreaterThan(0);
  });

  it('returns nothing for an empty query rather than the whole catalogue', () => {
    expect(searchCatalog('   ', STYLES_DIR)).toEqual([]);
  });

  it('respects the limit', () => {
    expect(searchCatalog('journal', STYLES_DIR, 5)).toHaveLength(5);
  });
});

describe('rendering a catalogue style', () => {
  it('resolves a journal style by its own id and name', () => {
    const entry = findStyle('journal-of-cleaner-production');
    expect(entry?.label).toBe('Journal of Cleaner Production');
    expect(entry?.xmlId).toBe('elsevier-harvard');
    expect(isKnownStyle('journal-of-cleaner-production')).toBe(true);
  });

  it('needs nothing fetched when the parent is one of the twenty shipped', () => {
    // Hundreds of journals borrow Elsevier Harvard, APA or Vancouver, all of which ship.
    const entry = findStyle('journal-of-cleaner-production');
    expect(entry && needsStyleXml(entry)).toBe(false);
    expect(entry && styleXml(entry)).toContain('<style');
  });

  it('does need fetching for an independent style that does not ship', () => {
    const entry = findStyle('harvard-anglia-ruskin-university');
    expect(entry).not.toBeNull();
    expect(entry && needsStyleXml(entry)).toBe(true);
    // And says so, rather than rendering something else, if asked before it is loaded.
    expect(() => entry && styleXml(entry)).toThrow(StyleNotLoadedError);
  });

  it('renders once its XML is registered', () => {
    const entry = findStyle('harvard-anglia-ruskin-university');
    registerStyleXml(
      'harvard-anglia-ruskin-university',
      '<style xmlns="http://purl.org/net/xbiblio/csl"><citation/></style>',
    );
    expect(entry && needsStyleXml(entry)).toBe(false);
    expect(entry && styleXml(entry)).toContain('xbiblio');
  });

  it('knows a footnote style as a style of its own (ADR-0029)', () => {
    const notes =
      catalogStyle('chicago-notes-bibliography', STYLES_DIR)?.id ??
      (catalogStyle('chicago-fullnote-bibliography', STYLES_DIR)?.id as string);
    expect(findStyle(notes)?.id).toBe(notes);
    expect(isKnownStyle(notes)).toBe(true);
    expect(resolveStyle(notes).id).toBe(notes);
  });

  it('still falls back to the default for an id that is no style at all', () => {
    expect(isKnownStyle('not-a-style')).toBe(false);
    expect(resolveStyle('not-a-style').id).toBe('apa');
  });

  it('still knows the twenty shipped styles by their short ids', () => {
    expect(findStyle('harvard')?.file).toBe('harvard-cite-them-right.csl');
    expect(findStyle('mla')?.file).toBe('modern-language-association.csl');
  });
});
