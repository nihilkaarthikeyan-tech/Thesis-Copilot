/**
 * The library, exported.
 *
 * Most of what can go wrong here is invisible until the file is used somewhere else: a key that
 * changes between two exports breaks a student's LaTeX, a colliding key silently merges two
 * references in their reference manager, a title that starts with "=" runs as a formula in their
 * spreadsheet. The tests are about those, more than about the formats themselves, which
 * citation-js writes.
 */

import { describe, expect, it } from 'vitest';
import {
  citationKeys,
  csvField,
  exportLibrary,
  type LibrarySource,
} from '../src/library-export.js';

const lecun: LibrarySource = {
  id: 's1',
  status: 'RESOLVED',
  title: 'Deep learning',
  authors: [{ family: 'LeCun', given: 'Yann' }],
  year: 2015,
  venue: 'Nature',
  doi: '10.1038/nature14539',
};

describe('citationKeys', () => {
  it('builds author, year and the first meaningful title word', () => {
    expect(citationKeys([lecun]).get('s1')).toBe('LeCun2015Deep');
  });

  it('skips a leading article, which identifies nothing', () => {
    const keys = citationKeys([{ ...lecun, id: 's2', title: 'The limits of learning' }]);
    expect(keys.get('s2')).toBe('LeCun2015limits');
  });

  it('folds accents, because a BibTeX key cannot carry them', () => {
    const keys = citationKeys([
      { id: 'm', title: 'Über Methode', authors: [{ family: 'Müller', given: 'J' }], year: 2020 },
    ]);
    expect(keys.get('m')).toBe('Muller2020Uber');
  });

  it('never gives two sources the same key', () => {
    // Same author, same year, titles starting with the same word: the case that collides.
    const keys = citationKeys([
      lecun,
      { ...lecun, id: 's2', title: 'Deep nets revisited' },
      { ...lecun, id: 's3', title: 'Deep again' },
    ]);
    expect(new Set(keys.values()).size).toBe(3);
    expect(keys.get('s1')).toBe('LeCun2015Deep');
    expect(keys.get('s2')).toBe('LeCun2015Deepb');
    expect(keys.get('s3')).toBe('LeCun2015Deepc');
  });

  it('is stable: the source that claimed a key first keeps it when more are added', () => {
    // A student who wrote \cite{LeCun2015Deep} after the first export must not find it pointing
    // at a different paper after the second.
    const before = citationKeys([lecun]);
    const after = citationKeys([lecun, { ...lecun, id: 's2', title: 'Deep nets' }]);
    expect(after.get('s1')).toBe(before.get('s1'));
  });

  it('still produces a usable key for a source with nothing known about it', () => {
    expect(citationKeys([{ id: 'blank' }]).get('blank')).toBe('ref');
  });
});

describe('BibTeX', () => {
  it('writes a real entry, with the key the student will cite', () => {
    const { body, extension, mimeType } = exportLibrary([lecun], 'bib');
    expect(extension).toBe('bib');
    expect(mimeType).toContain('bibtex');
    expect(body).toMatch(/^@article\{LeCun2015Deep,/m);
    expect(body).toContain('doi = {10.1038/nature14539}');
    expect(body).toContain('journal = {Nature}');
  });

  it('escapes what LaTeX would otherwise choke on', () => {
    const { body } = exportLibrary(
      [
        {
          id: 'x',
          title: 'Costs & benefits of {solar} dryers',
          authors: [{ family: 'Rao' }],
          year: 2021,
        },
      ],
      'bib',
    );
    expect(body).toContain('\\&');
    expect(body).not.toMatch(/title = \{[^}]*[^\\]&/);
  });

  it('exports an unidentified reference, and says so, rather than dropping it', () => {
    const { body } = exportLibrary(
      [{ id: 'u', status: 'UNRESOLVED', rawReference: 'Kumar A. Solar adoption. 2021.' }],
      'bib',
    );
    // Braces around capitalised words are BibTeX case protection, which citation-js adds.
    expect(body).toMatch(/title = \{Kumar \{A\}\. \{Solar\} adoption/);
    expect(body).toContain('could not match this reference');
  });

  it('says a reference still being looked up is unverified, not that it failed', () => {
    const { body } = exportLibrary(
      [{ id: 'p', status: 'PENDING', rawReference: 'Rao B. Dryers. 2019.' }],
      'bib',
    );
    expect(body).toContain('still being looked up');
    expect(body).not.toContain('could not match');
  });

  it('marks a retracted paper in the entry itself', () => {
    const { body } = exportLibrary([{ ...lecun, isRetracted: true }], 'bib');
    expect(body).toContain('RETRACTED');
  });
});

describe('RIS', () => {
  it('writes a record Zotero and EndNote read, keyed the same as the BibTeX', () => {
    const { body } = exportLibrary([lecun], 'ris');
    expect(body).toMatch(/^TY {2}- JOUR/m);
    expect(body).toContain('TI  - Deep learning');
    expect(body).toContain('DO  - 10.1038/nature14539');
    expect(body).toContain('ID  - LeCun2015Deep');
    expect(body).toMatch(/^ER {2}-/m);
  });
});

describe('CSV', () => {
  it('has a header row, one row per source, CRLF line ends and a BOM', () => {
    const { body } = exportLibrary([lecun, { ...lecun, id: 's2', title: 'Deep nets' }], 'csv');
    expect(body.charCodeAt(0)).toBe(0xfeff);
    const lines = body.slice(1).split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^Key,Title,Authors,Year/);
    expect(lines[1]).toContain('LeCun2015Deep,Deep learning,"LeCun, Yann",2015,Nature');
  });

  it('quotes a field with a comma or a quote in it', () => {
    expect(csvField('a, b')).toBe('"a, b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('line\nbreak')).toBe('"line\nbreak"');
  });

  it('defuses a title that a spreadsheet would run as a formula', () => {
    // Titles are data somebody else wrote. "=HYPERLINK(...)" opened in Excel is a live link.
    expect(csvField('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(csvField('+1 and more')).toBe("'+1 and more");
    expect(csvField('-2 degrees')).toBe("'-2 degrees");
    expect(csvField('@home')).toBe("'@home");
  });

  it('writes nothing, not "null", for a missing value', () => {
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
  });
});
