/**
 * Europe PMC full text — PRD FR-2.2, ADR-0054.
 *
 * The open-access PDF is often unreachable from a server even when the paper is free: Springer
 * (and so Nature, BMC, SpringerOpen) answers non-browser clients with a JavaScript bot check
 * since 2026, and Unpaywall lists the same publisher URL as its only copy. Europe PMC serves the
 * full text of every paper in its open-access subset as JATS XML, without a key and with
 * permission, so for the life sciences it is a second road to FULL_TEXT that no bot check blocks.
 * Getting past a bot check would be detection evasion; this is the sanctioned route instead.
 *
 * §0.3 rule 1 — the contract below was read from the API itself on 2026-10-04:
 *
 *   GET https://www.ebi.ac.uk/europepmc/webservices/rest/search
 *       ?query=DOI:"10.1371/journal.pone.0185809"&format=json&resultType=lite
 *   → {"hitCount":1,"resultList":{"result":[{"id":"29045418","source":"MED","pmid":"29045418",
 *      "pmcid":"PMC5646769","doi":"10.1371/journal.pone.0185809","title":"More than 75 percent …",
 *      "isOpenAccess":"Y","inEPMC":"Y","inPMC":"Y","hasPDF":"Y",…}]}}
 *
 *   GET https://www.ebi.ac.uk/europepmc/webservices/rest/PMC5646769/fullTextXML
 *   → 200 application/xml, a JATS <article>: <front>…<abstract><title>Abstract</title><p>…</p>
 *     </abstract>…</front><body><sec id="sec001"><title>Introduction</title><p>… [<xref …>1</xref>]
 *     …</p>…<table-wrap><label>Table 1</label><caption><title>…</title></caption><table>
 *     <thead><tr><th>Year</th>…</tr></thead><tbody><tr><td>1989</td>…</tr>…</table></table-wrap>
 *     …<disp-formula><label>(1)</label><mml:math>…</mml:math></disp-formula>…</body>
 *
 * Only the fields quoted above are read, and a hit is used only when its DOI matches exactly.
 */

import type { SectionSpan } from '../chunker.js';
import { type ScholarlyClientOptions, ScholarlyHttp } from './http.js';
import { elements, firstInner, plainText } from './xml.js';

/** Europe PMC asks for "reasonable" use; two a second is well inside it and the call is rare. */
export const EUROPE_PMC_REQUESTS_PER_SECOND = 2;

const API = 'https://www.ebi.ac.uk/europepmc/webservices/rest';

export type EuropePmcFullText = {
  pmcid: string;
  text: string;
  sections: SectionSpan[];
  /** The article page a person can open, for the log. */
  url: string;
};

type SearchResponse = {
  resultList?: {
    result?: Array<{
      doi?: string | null;
      pmcid?: string | null;
      isOpenAccess?: string | null;
      inEPMC?: string | null;
    }>;
  };
};

function normaliseDoi(doi: string | null | undefined): string | null {
  if (!doi) return null;
  const bare = doi
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:/i, '')
    .toLowerCase();
  return bare.length > 0 ? bare : null;
}

export class EuropePmcClient {
  private readonly http: ScholarlyHttp;

  constructor(options: ScholarlyClientOptions) {
    this.http = new ScholarlyHttp('europepmc', {
      ...options,
      requestsPerSecond: options.requestsPerSecond ?? EUROPE_PMC_REQUESTS_PER_SECOND,
    });
  }

  /**
   * The full text of the open-access paper with this DOI, or null when Europe PMC has none.
   * Two requests: the search that finds the PMC id, then the article itself.
   */
  async fullText(doi: string, signal?: AbortSignal): Promise<EuropePmcFullText | null> {
    const wanted = normaliseDoi(doi);
    if (!wanted) return null;

    const query = encodeURIComponent(`DOI:"${wanted}"`);
    const search = await this.http.getJson<SearchResponse>(
      `${API}/search?query=${query}&format=json&resultType=lite&pageSize=5`,
      signal,
    );
    const hit = (search?.resultList?.result ?? []).find(
      (r) =>
        normaliseDoi(r.doi) === wanted &&
        typeof r.pmcid === 'string' &&
        /^PMC\d+$/.test(r.pmcid) &&
        r.isOpenAccess === 'Y' &&
        r.inEPMC === 'Y',
    );
    if (!hit?.pmcid) return null;

    const xml = await this.http.getText(
      `${API}/${hit.pmcid}/fullTextXML`,
      'application/xml',
      signal,
    );
    if (!xml) return null;
    const parsed = jatsToText(xml);
    if (!parsed) return null;
    return { pmcid: hit.pmcid, ...parsed, url: `https://europepmc.org/article/PMC/${hit.pmcid}` };
  }
}

/** Kept through `plainText`, which collapses whitespace but not these, then turned into layout. */
const ROW = '\u0001';
const CELL = '\u0002';

/** A table or figure as one block: its label, caption and, for a table, its rows cell by cell. */
function floatBlock(inner: string): string {
  const label = plainText(firstInner(inner, 'label'));
  const caption = plainText(firstInner(inner, 'caption')?.replace(/<\/(title|p)>/g, '$& '));
  const table = firstInner(inner, 'table');
  const rows = table
    ? table.replace(/<\/t[hd]>/g, `${CELL}</td>`).replace(/<\/tr>/g, `${ROW}</tr>`)
    : '';
  const head = [label, caption].filter(Boolean).join('. ');
  return `<tc-block>${head}${rows ? ROW + rows : ''}</tc-block>`;
}

function layout(text: string): string {
  return text
    .replace(new RegExp(`\\s*${CELL}\\s*${ROW}`, 'g'), ROW)
    .replace(new RegExp(`\\s*${CELL}\\s*`, 'g'), ' | ')
    .replace(new RegExp(`\\s*${ROW}\\s*`, 'g'), '\n')
    .trim();
}

/**
 * A JATS article → plain text with a span per top-level section, or null when it has no body
 * (an abstract alone is not full text, and the abstract path already covers it).
 *
 * Tables are kept row by row, cells separated by " | ", because the numbers a student asks about
 * are most often in a table (the comparison with Jenni, 2026-10-04, failed on exactly that).
 * References, graphics and supplementary files are dropped. Maths keeps the text of its MathML,
 * which reads plainly enough for retrieval though not for print.
 */
export function jatsToText(xml: string): { text: string; sections: SectionSpan[] } | null {
  const rawBody = firstInner(xml, 'body');
  if (!rawBody) return null;

  const body = rawBody
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<\/label>/g, '</label> ')
    .replace(/<supplementary-material\b[\s\S]*?<\/supplementary-material>/g, '')
    .replace(/<ref-list\b[\s\S]*?<\/ref-list>/g, '')
    .replace(/<table-wrap\b[^>]*>([\s\S]*?)<\/table-wrap>/g, (_w, inner: string) =>
      floatBlock(inner),
    )
    .replace(/<fig\b[^>]*>([\s\S]*?)<\/fig>/g, (_w, inner: string) => floatBlock(inner));

  const parts: string[] = [];
  const sections: SectionSpan[] = [];
  let length = 0;
  let current = '';

  const emit = (section: string, text: string) => {
    const clean = layout(text);
    if (!clean) return;
    if (parts.length > 0) length += 2; // the '\n\n' the join puts in front
    const start = length;
    parts.push(clean);
    length += clean.length;
    const last = sections[sections.length - 1];
    if (last && last.section === section) last.end = length;
    else sections.push({ section, start, end: length });
  };

  const abstract = firstInner(xml, 'abstract');
  if (abstract) {
    for (const p of elements(abstract, 'p')) emit('Abstract', plainText(p.inner));
  }

  let depth = 0;
  const token =
    /<sec\b[^>]*>|<\/sec>|<title>([\s\S]*?)<\/title>|<(p|tc-block|disp-formula)\b[^>]*>([\s\S]*?)<\/\2>/g;
  for (const match of body.matchAll(token)) {
    const whole = match[0];
    if (whole.startsWith('<sec')) depth++;
    else if (whole === '</sec>') depth = Math.max(0, depth - 1);
    else if (match[1] !== undefined) {
      const title = plainText(match[1]);
      if (depth <= 1) current = title;
      else emit(current || 'Main text', title);
    } else {
      emit(current || 'Main text', plainText(match[3]));
    }
  }

  const text = parts.join('\n\n');
  // An article whose body is only figures, or empty, gives nothing worth calling full text.
  if (!sections.some((s) => s.section !== 'Abstract')) return null;
  return { text, sections };
}
