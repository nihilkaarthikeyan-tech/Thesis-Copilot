/**
 * PubMed, through NCBI's E-utilities — ADR-0020.
 *
 * What PubMed adds over OpenAlex is its indexing: MeSH-mapped search over the biomedical and life
 * sciences literature, which is what a student in those fields expects "search" to mean, and a
 * publication-type field that says outright when a paper has been retracted.
 *
 * Two requests per query: `esearch` for the ids (JSON), then `efetch` for the records (XML — the
 * JSON `esummary` carries no abstract, and the abstract is what the relevance filter reads).
 *
 * NCBI allows three requests a second per address without a key and ten with one
 * (`NCBI_API_KEY`), and asks every caller to name itself with `tool` and `email`.
 */

import { DISCOVER, type DiscoveredWork, normaliseDoi } from './discover.js';
import { type ScholarlyClientOptions, ScholarlyHttp } from './http.js';
import { keywordsOf } from './keywords.js';
import { attribute, elements, firstInner, plainText } from './xml.js';

export const PUBMED = {
  /** Results per query — ten, like arXiv: every candidate costs an embedding in the run. */
  perQuery: 10,
  /** Spacing between requests: under 3/s without a key, under 10/s with one. */
  intervalMs: { withoutKey: 350, withKey: 110 },
  eutils: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils',
  tool: 'ThesisCopilot',
} as const;

export type PubmedRecord = {
  pmid: string;
  title: string;
  abstract: string | null;
  journal: string | null;
  year: number | null;
  doi: string | null;
  pmcid: string | null;
  authors: string[];
  publicationTypes: string[];
};

/**
 * Publication types that mark a record as something other than a source to offer: a retracted
 * paper, and the notices journals publish about other papers. A notice is findable because its
 * title quotes the paper it is about, so it ranks as well as the paper does.
 */
const NOT_A_SOURCE = new Set([
  'Retracted Publication',
  'Retraction of Publication',
  'Expression of Concern',
  'Published Erratum',
]);

export function isNotASource(record: PubmedRecord): boolean {
  return record.publicationTypes.some((type) => NOT_A_SOURCE.has(type));
}

function yearOf(article: string): number | null {
  const pubDate = firstInner(article, 'PubDate') ?? '';
  // `<Year>2024</Year>`, or `<MedlineDate>2019 Mar-Apr</MedlineDate>` for older records.
  const text =
    plainText(firstInner(pubDate, 'Year')) || plainText(firstInner(pubDate, 'MedlineDate'));
  const match = /\d{4}/.exec(text);
  return match ? Number.parseInt(match[0], 10) : null;
}

function abstractOf(article: string): string | null {
  const abstract = firstInner(article, 'Abstract');
  if (!abstract) return null;
  // Structured abstracts come in labelled sections; the labels are kept, as PubMed shows them.
  const parts = elements(abstract, 'AbstractText').map(({ attrs, inner }) => {
    const label = attribute(attrs, 'Label');
    const text = plainText(inner);
    return label && text ? `${label}: ${text}` : text;
  });
  return parts.filter(Boolean).join(' ') || null;
}

function idOf(ids: string, type: string): string | null {
  const found = elements(ids, 'ArticleId').find(({ attrs }) => attribute(attrs, 'IdType') === type);
  return found ? plainText(found.inner) || null : null;
}

export function parsePubmedArticles(xml: string): PubmedRecord[] {
  const out: PubmedRecord[] = [];
  for (const { inner } of elements(xml, 'PubmedArticle')) {
    // The article's own ids. A record also lists the ids of every paper it cites, each inside
    // `<ReferenceList>`, so that is cut away before anything reads an `<ArticleIdList>`.
    const own = inner.replace(/<ReferenceList>[\s\S]*?<\/ReferenceList>/g, '');
    const citation = firstInner(own, 'MedlineCitation') ?? '';
    const article = firstInner(citation, 'Article') ?? '';
    const pmid = plainText(firstInner(citation, 'PMID'));
    const title = plainText(firstInner(article, 'ArticleTitle')).replace(/\.$/, '');
    if (!pmid || !title) continue;

    const ids = firstInner(firstInner(own, 'PubmedData') ?? '', 'ArticleIdList') ?? '';
    const elocationDoi = elements(article, 'ELocationID').find(
      ({ attrs }) => attribute(attrs, 'EIdType') === 'doi',
    );
    out.push({
      pmid,
      title,
      abstract: abstractOf(article),
      journal: plainText(firstInner(firstInner(article, 'Journal') ?? '', 'Title')) || null,
      year: yearOf(article),
      doi: normaliseDoi(idOf(ids, 'doi') ?? (elocationDoi ? plainText(elocationDoi.inner) : null)),
      pmcid: idOf(ids, 'pmc'),
      authors: elements(firstInner(article, 'AuthorList') ?? '', 'Author').map(({ inner: a }) => {
        const collective = plainText(firstInner(a, 'CollectiveName'));
        if (collective) return collective;
        return [plainText(firstInner(a, 'LastName')), plainText(firstInner(a, 'Initials'))]
          .filter(Boolean)
          .join(' ');
      }),
      publicationTypes: elements(article, 'PublicationType').map(({ inner: t }) => plainText(t)),
    });
  }
  return out;
}

export function workFromPubmed(record: PubmedRecord): DiscoveredWork {
  return {
    openalexId: null,
    doi: record.doi,
    title: record.title,
    abstract: record.abstract,
    year: record.year,
    venue: record.journal,
    citationCount: null,
    isPreprint: record.publicationTypes.includes('Preprint'),
    // A PubMed Central copy is free to read; without one PubMed says nothing either way.
    oaStatus: record.pmcid ? 'green' : null,
    via: 'pubmed',
  };
}

export class PubMedClient {
  private readonly http: ScholarlyHttp;
  private readonly identity: string;

  constructor(options: ScholarlyClientOptions) {
    const interval = options.apiKey ? PUBMED.intervalMs.withKey : PUBMED.intervalMs.withoutKey;
    // `ScholarlyHttp` adds `api_key` to every request itself (the shared mechanism OpenAlex's key
    // uses too), so it is not written into the identity string as well.
    this.http = new ScholarlyHttp('pubmed', {
      ...options,
      requestsPerSecond: options.requestsPerSecond ?? 1000 / interval,
    });
    this.identity = `tool=${PUBMED.tool}&email=${encodeURIComponent(options.mailto)}`;
  }

  /** Up to ten recent records for a query, best match first, retractions and notices left out. */
  async search(query: string, now = new Date(), signal?: AbortSignal): Promise<DiscoveredWork[]> {
    const words = keywordsOf(query, 6);
    if (words.length === 0) return [];
    const from = now.getUTCFullYear() - DISCOVER.yearsBack;
    const found = await this.http.getJson<{ esearchresult?: { idlist?: string[] } }>(
      `${PUBMED.eutils}/esearch.fcgi?db=pubmed&retmode=json&sort=relevance` +
        `&retmax=${PUBMED.perQuery}&datetype=pdat&mindate=${from}&maxdate=3000` +
        `&term=${encodeURIComponent(words.join(' '))}&${this.identity}`,
      signal,
    );
    const ids = (found?.esearchresult?.idlist ?? []).filter((id) => /^\d+$/.test(id));
    if (ids.length === 0) return [];
    const xml = await this.http.getText(
      `${PUBMED.eutils}/efetch.fcgi?db=pubmed&retmode=xml&id=${ids.join(',')}&${this.identity}`,
      'application/xml',
      signal,
    );
    const records = parsePubmedArticles(xml ?? '');
    // efetch does not promise esearch's order; relevance is esearch's, so it is restored. A record
    // that was not asked for is not offered.
    const rank = new Map(ids.map((id, i) => [id, i]));
    return records
      .filter((record) => rank.has(record.pmid) && !isNotASource(record))
      .sort((a, b) => (rank.get(a.pmid) ?? 0) - (rank.get(b.pmid) ?? 0))
      .map(workFromPubmed);
  }

  /** Jenni build plan R16 (ADR-0103): one record by its PubMed id, or null when there is none. */
  async byPmid(pmid: string, signal?: AbortSignal): Promise<PubmedRecord | null> {
    if (!/^\d{1,9}$/.test(pmid)) return null;
    const xml = await this.http.getText(
      `${PUBMED.eutils}/efetch.fcgi?db=pubmed&retmode=xml&id=${pmid}&${this.identity}`,
      'application/xml',
      signal,
    );
    return parsePubmedArticles(xml ?? '').find((record) => record.pmid === pmid) ?? null;
  }
}
