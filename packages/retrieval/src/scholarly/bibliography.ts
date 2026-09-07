/**
 * BibTeX / RIS import — PRD FR-2.9, PHASES v2 W7.5.
 *
 * "Zotero/Mendeley import via BibTeX/RIS file upload (not OAuth)." Both formats are parsed into
 * the same shape the resolve pipeline already takes: a raw reference string plus a DOI when the
 * entry carries one. The parser is deliberately plain — braces, quotes and `#` concatenation for
 * BibTeX; two-letter tags for RIS — and skips what it cannot read rather than guessing.
 */

export type BibEntry = {
  /** BibTeX key or RIS ID when present. */
  key: string | null;
  type: string;
  title: string | null;
  authors: string[];
  year: number | null;
  venue: string | null;
  doi: string | null;
  /** A reference line built from the fields, for the resolve pipeline and the library row. */
  raw: string;
};

export type BibFormat = 'bibtex' | 'ris';

export function detectBibFormat(text: string, filename?: string): BibFormat | null {
  const name = (filename ?? '').toLowerCase();
  if (name.endsWith('.bib') || name.endsWith('.bibtex')) return 'bibtex';
  if (name.endsWith('.ris')) return 'ris';
  if (/^\s*@\w+\s*[{(]/m.test(text)) return 'bibtex';
  if (/^TY\s{2}-\s/m.test(text)) return 'ris';
  return null;
}

const cleanDoi = (value: string | null): string | null => {
  if (!value) return null;
  const d = value
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '');
  return /^10\.\d{4,9}\/\S+/.test(d) ? d : null;
};

/** A citation-shaped line from the fields; what the library shows until resolution fills it. */
function rawLine(e: Omit<BibEntry, 'raw'>): string {
  const who = e.authors.length
    ? `${e.authors.slice(0, 3).join(', ')}${e.authors.length > 3 ? ', et al.' : ''}`
    : '';
  const parts = [
    who,
    e.year ? `(${e.year}).` : '',
    e.title ? `${e.title}.` : '',
    e.venue ? `${e.venue}.` : '',
    e.doi ? `https://doi.org/${e.doi}` : '',
  ].filter(Boolean);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------------------------
// BibTeX
// ---------------------------------------------------------------------------------------------

/** Strips one level of `{…}` or `"…"`, joins `#` concatenations, unescapes common TeX. */
function bibValue(raw: string, strings: Map<string, string>): string {
  const parts: string[] = [];
  let i = 0;
  const s = raw.trim();
  while (i < s.length) {
    const ch = s[i];
    if (ch === '{') {
      let depth = 0;
      let j = i;
      for (; j < s.length; j++) {
        if (s[j] === '{') depth++;
        else if (s[j] === '}') {
          depth--;
          if (depth === 0) break;
        }
      }
      parts.push(s.slice(i + 1, j));
      i = j + 1;
    } else if (ch === '"') {
      const j = s.indexOf('"', i + 1);
      parts.push(s.slice(i + 1, j === -1 ? s.length : j));
      i = j === -1 ? s.length : j + 1;
    } else if (ch === '#' || /\s/.test(ch ?? '')) {
      i++;
    } else {
      let j = i;
      while (j < s.length && !/[#\s]/.test(s[j] ?? '')) j++;
      const token = s.slice(i, j);
      parts.push(strings.get(token.toLowerCase()) ?? token);
      i = j;
    }
  }
  return decodeTex(parts.join(''));
}

/** TeX accent command → the Unicode combining mark it stands for. */
const ACCENTS: Record<string, string> = {
  '`': '̀', // grave
  "'": '́', // acute
  '^': '̂', // circumflex
  '"': '̈', // diaeresis
  '~': '̃', // tilde
  '=': '̄', // macron
  '.': '̇', // dot above
  c: '̧', // cedilla
  v: '̌', // caron
  u: '̆', // breve
  H: '̋', // double acute
};

/** Letters TeX writes as a whole command rather than a letter plus an accent. */
const LIGATURES: Record<string, string> = {
  ss: 'ß',
  o: 'ø',
  O: 'Ø',
  aa: 'å',
  AA: 'Å',
  ae: 'æ',
  AE: 'Æ',
  oe: 'œ',
  OE: 'Œ',
  l: 'ł',
  L: 'Ł',
};

/**
 * Turns TeX escapes into the characters they stand for.
 *
 * This used to drop the accent and keep the letter, which turned Müller into Muller and García
 * into Garcia. A misspelled name is a misspelled citation in a submitted bibliography, and it is
 * the author's name — so the accent is decoded rather than discarded. Anything unrecognised keeps
 * its letter, which is still better than losing the word.
 */
export function decodeTex(text: string): string {
  return (
    text
      // `\"{U}`, `\"U`, `{\"U}` — the brace forms Zotero and BibDesk both write.
      .replace(/\\([`'^"~=.cvuH])\s*\{?([a-zA-Z])\}?/g, (_, accent: string, letter: string) =>
        `${letter}${ACCENTS[accent] ?? ''}`.normalize('NFC'),
      )
      .replace(
        /\\(ss|aa|AA|ae|AE|oe|OE|[oOlL])(?![a-zA-Z])\{?\}?/g,
        (whole, name: string) => LIGATURES[name] ?? whole,
      )
      .replace(/\\&/g, '&')
      .replace(/\\%/g, '%')
      .replace(/\\_/g, '_')
      .replace(/[{}]/g, '')
      .replace(/~/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function splitBibFields(body: string): Map<string, string> {
  const fields = new Map<string, string>();
  let i = 0;
  while (i < body.length) {
    const eq = body.indexOf('=', i);
    if (eq === -1) break;
    const name = body
      .slice(i, eq)
      .replace(/^[\s,]+/, '')
      .trim()
      .toLowerCase();
    let j = eq + 1;
    let depth = 0;
    let inQuote = false;
    for (; j < body.length; j++) {
      const c = body[j];
      if (c === '"' && depth === 0) inQuote = !inQuote;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === ',' && depth === 0 && !inQuote) break;
    }
    if (name) fields.set(name, body.slice(eq + 1, j));
    i = j + 1;
  }
  return fields;
}

export function parseBibtex(text: string): BibEntry[] {
  const strings = new Map<string, string>();
  const entries: BibEntry[] = [];
  const re = /@(\w+)\s*[{(]/g;
  let m: RegExpExecArray | null = re.exec(text);
  while (m) {
    const type = (m[1] ?? '').toLowerCase();
    // Find the matching close brace for this entry.
    let depth = 1;
    let j = re.lastIndex;
    for (; j < text.length && depth > 0; j++) {
      if (text[j] === '{' || text[j] === '(') depth++;
      else if (text[j] === '}' || text[j] === ')') depth--;
    }
    const body = text.slice(re.lastIndex, j - 1);
    re.lastIndex = j;

    if (type === 'comment' || type === 'preamble') {
      m = re.exec(text);
      continue;
    }
    if (type === 'string') {
      const fields = splitBibFields(body);
      for (const [k, v] of fields) strings.set(k, bibValue(v, strings));
      m = re.exec(text);
      continue;
    }
    const comma = body.indexOf(',');
    const key = comma === -1 ? body.trim() : body.slice(0, comma).trim();
    const fields = splitBibFields(comma === -1 ? '' : body.slice(comma + 1));
    const get = (name: string) => {
      const v = fields.get(name);
      return v === undefined ? null : bibValue(v, strings) || null;
    };
    const authors = (get('author') ?? '')
      .split(/\s+and\s+/i)
      .map((a) => a.trim())
      .filter(Boolean);
    const yearText = get('year') ?? get('date');
    const year = yearText ? Number(/\d{4}/.exec(yearText)?.[0]) || null : null;
    const partial = {
      key: key || null,
      type,
      title: get('title'),
      authors,
      year,
      venue: get('journal') ?? get('booktitle') ?? get('publisher'),
      doi: cleanDoi(get('doi')),
    };
    if (partial.title || partial.doi) entries.push({ ...partial, raw: rawLine(partial) });
    m = re.exec(text);
  }
  return entries;
}

// ---------------------------------------------------------------------------------------------
// RIS
// ---------------------------------------------------------------------------------------------

const RIS_TYPES: Record<string, string> = {
  JOUR: 'article',
  BOOK: 'book',
  CHAP: 'incollection',
  CONF: 'inproceedings',
  CPAPER: 'inproceedings',
  THES: 'phdthesis',
  RPRT: 'techreport',
  GEN: 'misc',
};

export function parseRis(text: string): BibEntry[] {
  const entries: BibEntry[] = [];
  let current: Map<string, string[]> | null = null;
  const flush = () => {
    if (!current) return;
    const one = (tag: string) => current?.get(tag)?.[0] ?? null;
    const authors = [...(current.get('AU') ?? []), ...(current.get('A1') ?? [])].map((a) =>
      a.trim(),
    );
    const yearText = one('PY') ?? one('Y1') ?? one('DA');
    const partial = {
      key: one('ID'),
      type: RIS_TYPES[one('TY') ?? ''] ?? 'misc',
      title: one('TI') ?? one('T1'),
      authors,
      year: yearText ? Number(/\d{4}/.exec(yearText)?.[0]) || null : null,
      venue: one('JO') ?? one('JF') ?? one('T2') ?? one('PB'),
      doi: cleanDoi(one('DO')),
    };
    if (partial.title || partial.doi) entries.push({ ...partial, raw: rawLine(partial) });
    current = null;
  };
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9])\s{2}-\s?(.*)$/.exec(line);
    if (!m) continue;
    const tag = m[1] ?? '';
    const value = (m[2] ?? '').trim();
    if (tag === 'TY') {
      flush();
      current = new Map([['TY', [value]]]);
      continue;
    }
    if (tag === 'ER') {
      flush();
      continue;
    }
    if (!current) continue;
    current.set(tag, [...(current.get(tag) ?? []), value]);
  }
  flush();
  return entries;
}

export function parseBibliography(
  text: string,
  filename?: string,
): { format: BibFormat; entries: BibEntry[]; skipped: number } | null {
  const format = detectBibFormat(text, filename);
  if (!format) return null;
  const entries = format === 'bibtex' ? parseBibtex(text) : parseRis(text);
  // An entry with neither a title nor a DOI cannot be resolved and is dropped. Counting the drops
  // is the difference between "38 of your 40 references came across" and a student wondering
  // where two of them went.
  return { format, entries, skipped: Math.max(0, countRecords(text, format) - entries.length) };
}

/** How many records the file contains, whether or not they could be read. */
function countRecords(text: string, format: BibFormat): number {
  if (format === 'ris') return (text.match(/^TY {2}- /gm) ?? []).length;
  return (text.match(/@(?!string\b|comment\b|preamble\b)\w+\s*[{(]/gi) ?? []).length;
}
