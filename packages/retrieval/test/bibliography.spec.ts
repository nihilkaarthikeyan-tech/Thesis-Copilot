/**
 * BibTeX / RIS import — PRD FR-2.9, PHASES v2 W7.5, "Tests owed (week 7)".
 *
 *   "Bibliography parser: a BibTeX fixture with `@string`, braces and accents; a RIS fixture."
 *
 * A student's Zotero export is the messiest input the product accepts: fifteen years of a library
 * exported by four versions of two tools. The parser's job is to get the DOI and enough of a
 * reference line for the resolve pipeline, and to **skip what it cannot read rather than guess** —
 * an entry silently mangled into a wrong citation is worse than one that never arrives, because
 * the student can see the second.
 */

import { describe, expect, it } from 'vitest';
import {
  decodeTex,
  detectBibFormat,
  parseBibliography,
  parseBibtex,
  parseRis,
} from '../src/scholarly/bibliography.js';

const BIBTEX = String.raw`
@string{re = "Renewable Energy"}
@string{se = "Solar Energy"}

% A comment line Zotero likes to write.
@article{kumar2021solar,
  title   = {Solar drying of marine fish in coastal {T}amil {N}adu},
  author  = {Kumar, A. and Raman, S.},
  journal = re,
  year    = {2021},
  doi     = {10.1016/j.renene.2021.01.001}
}

@article{bose2019forced,
  title   = "A forced-convection dryer for small landings",
  author  = "Bose, P.",
  journal = se,
  year    = 2019,
  doi     = {https://doi.org/10.1016/j.solener.2019.05.002}
}

@inproceedings{muller2018,
  title  = {Trocknung von Fisch: eine {\"U}bersicht},
  author = {M{\"u}ller, J. and Garc{\'i}a, M.},
  year   = {2018},
  booktitle = {Proceedings of the Drying Symposium}
}

@misc{nokey,
  author = {Anonymous},
  year   = {2020}
}
`;

const RIS = `TY  - JOUR
TI  - Post-harvest losses in Indian fisheries
AU  - Anand, R.
AU  - Iyer, M.
AU  - Das, K.
PY  - 2018
JO  - Food Policy
DO  - 10.1016/j.foodpol.2018.03.004
ID  - anand2018
ER  -

TY  - CHAP
T1  - Drying kinetics of small pelagics
AU  - Bose, P.
Y1  - 2019/06/01
T2  - Handbook of Fish Processing
DO  - doi:10.1000/xyz123
ER  -

TY  - JOUR
TI  - An entry with no year and no DOI
AU  - Someone, A.
ER  -
`;

describe('detectBibFormat', () => {
  it('trusts the extension first', () => {
    expect(detectBibFormat('anything at all', 'library.bib')).toBe('bibtex');
    expect(detectBibFormat('anything at all', 'library.RIS')).toBe('ris');
    expect(detectBibFormat('x', 'export.bibtex')).toBe('bibtex');
  });

  it('falls back to the content when the name says nothing', () => {
    expect(detectBibFormat(BIBTEX, 'export.txt')).toBe('bibtex');
    expect(detectBibFormat(RIS, 'export.txt')).toBe('ris');
  });

  it('returns null for something that is neither, so the caller can say so', () => {
    expect(detectBibFormat('Kumar, A. (2021). Solar drying. Renewable Energy.', 'notes.txt')).toBe(
      null,
    );
    expect(detectBibFormat('', 'empty.txt')).toBe(null);
  });
});

describe('BibTeX', () => {
  const entries = parseBibtex(BIBTEX);

  it('reads every readable entry and ignores @string and comments', () => {
    expect(entries.map((e) => e.key)).toEqual(['kumar2021solar', 'bose2019forced', 'muller2018']);
  });

  it('expands a @string abbreviation into the journal name', () => {
    expect(entries[0]?.venue).toBe('Renewable Energy');
    expect(entries[1]?.venue).toBe('Solar Energy');
  });

  it('strips the braces that protect capitalisation', () => {
    expect(entries[0]?.title).toBe('Solar drying of marine fish in coastal Tamil Nadu');
  });

  it('reads quoted values as well as braced ones', () => {
    expect(entries[1]?.title).toBe('A forced-convection dryer for small landings');
  });

  it('reads a bare numeric year', () => {
    expect(entries[1]?.year).toBe(2019);
  });

  it('splits authors on "and" and keeps their comma order', () => {
    expect(entries[0]?.authors).toEqual(['Kumar, A.', 'Raman, S.']);
  });

  it('normalises a DOI given as a URL', () => {
    expect(entries[1]?.doi).toBe('10.1016/j.solener.2019.05.002');
  });

  it('leaves the DOI null rather than inventing one', () => {
    expect(entries[2]?.doi).toBe(null);
  });

  it('decodes accents written the TeX way', () => {
    // A student's German or Spanish sources arrive like this, and a mangled name is a mangled
    // citation in the bibliography.
    expect(entries[2]?.title).toContain('Übersicht');
    expect(entries[2]?.authors.join(' ')).toContain('Müller');
    expect(entries[2]?.authors.join(' ')).toContain('García');
  });

  it('falls back to booktitle when there is no journal', () => {
    expect(entries[2]?.venue).toBe('Proceedings of the Drying Symposium');
  });

  it('drops an entry with neither a title nor a DOI — there is nothing to resolve it by', () => {
    // `@misc{nokey}` in the fixture has an author and a year and nothing else. Guessing at it
    // would put a wrong citation in a bibliography; `parseBibliography` counts it as skipped so
    // the student is told rather than left to notice the shortfall.
    expect(entries.map((e) => e.key)).not.toContain('nokey');
  });

  it('builds a raw reference line the resolve pipeline can search on', () => {
    const raw = entries[0]?.raw ?? '';
    expect(raw).toContain('Kumar');
    expect(raw).toContain('2021');
    expect(raw).toContain('Solar drying of marine fish');
  });

  it('reads the entry type', () => {
    expect(entries.map((e) => e.type)).toEqual(['article', 'article', 'inproceedings']);
  });

  it('returns nothing for an empty file rather than throwing', () => {
    expect(parseBibtex('')).toEqual([]);
    expect(parseBibtex('% only a comment\n')).toEqual([]);
  });
});

describe('RIS', () => {
  const entries = parseRis(RIS);

  it('reads every record', () => {
    expect(entries).toHaveLength(3);
  });

  it('accepts TI and T1 as the title', () => {
    expect(entries[0]?.title).toBe('Post-harvest losses in Indian fisheries');
    expect(entries[1]?.title).toBe('Drying kinetics of small pelagics');
  });

  it('collects repeated AU tags in order', () => {
    expect(entries[0]?.authors).toEqual(['Anand, R.', 'Iyer, M.', 'Das, K.']);
  });

  it('reads the year from PY and from a Y1 date', () => {
    expect(entries[0]?.year).toBe(2018);
    expect(entries[1]?.year).toBe(2019);
  });

  it('strips a "doi:" prefix', () => {
    expect(entries[1]?.doi).toBe('10.1000/xyz123');
  });

  it('reads the venue from JO and from T2', () => {
    expect(entries[0]?.venue).toBe('Food Policy');
    expect(entries[1]?.venue).toBe('Handbook of Fish Processing');
  });

  it('keeps an entry with no year and no DOI', () => {
    expect(entries[2]?.title).toBe('An entry with no year and no DOI');
    expect(entries[2]?.year).toBe(null);
    expect(entries[2]?.doi).toBe(null);
  });

  it('reads the ID when the export carries one', () => {
    expect(entries[0]?.key).toBe('anand2018');
  });

  it('returns nothing for an empty file', () => {
    expect(parseRis('')).toEqual([]);
  });
});

describe('parseBibliography', () => {
  it('routes each format to its parser and reports which it used', () => {
    expect(parseBibliography(BIBTEX, 'zotero.bib')?.format).toBe('bibtex');
    expect(parseBibliography(RIS, 'mendeley.ris')?.format).toBe('ris');
  });

  it('returns null for a file that is neither, so the API can say what to export instead', () => {
    expect(parseBibliography('Just some notes.', 'notes.txt')).toBe(null);
  });

  it('returns an empty entry list rather than null for a well-formed but empty export', () => {
    const result = parseBibliography('', 'empty.bib');
    expect(result?.format).toBe('bibtex');
    expect(result?.entries).toEqual([]);
    expect(result?.skipped).toBe(0);
  });

  it('counts the entries it had to skip, so an import can say what it lost', () => {
    const result = parseBibliography(BIBTEX, 'zotero.bib');
    expect(result?.entries).toHaveLength(3);
    expect(result?.skipped).toBe(1);
  });

  it('counts RIS records the same way', () => {
    const result = parseBibliography(RIS, 'mendeley.ris');
    expect(result?.entries).toHaveLength(3);
    expect(result?.skipped).toBe(0);
  });
});

describe('decodeTex', () => {
  it('decodes an accent rather than dropping it', () => {
    // Muller and Garcia are different people from Müller and García, and the bibliography is
    // printed in a submitted thesis.
    expect(decodeTex(String.raw`M{\"u}ller`)).toBe('Müller');
    expect(decodeTex(String.raw`Garc{\'i}a`)).toBe('García');
    expect(decodeTex(String.raw`\'{E}cole`)).toBe('École');
    expect(decodeTex(String.raw`Fran\c{c}ois`)).toBe('François');
    expect(decodeTex(String.raw`\~{n}`)).toBe('ñ');
  });

  it('accepts the brace-free form too', () => {
    expect(decodeTex(String.raw`M\"uller`)).toBe('Müller');
  });

  it('decodes the letters TeX writes as whole commands', () => {
    expect(decodeTex(String.raw`Wei\ss{}enburg`)).toBe('Weißenburg');
    expect(decodeTex(String.raw`\AA{}ngstr\"om`)).toBe('Ångström');
  });

  it('unescapes the punctuation a title needs', () => {
    expect(decodeTex(String.raw`Wind \& solar`)).toBe('Wind & solar');
    expect(decodeTex(String.raw`A 20\% gain`)).toBe('A 20% gain');
  });

  it('keeps the letter when the command is one it does not know', () => {
    expect(decodeTex(String.raw`\textbf{Solar}`)).toContain('Solar');
  });

  it('leaves ordinary text alone', () => {
    expect(decodeTex('Solar drying of marine fish')).toBe('Solar drying of marine fish');
  });
});
