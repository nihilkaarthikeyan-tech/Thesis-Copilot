/**
 * Which paper an in-page button saves — ADR-0125. A button is tied to an identifier the page
 * itself states (a DOI, an arXiv id, a PubMed id), and the library is asked for exactly that
 * record through its paste-an-ID routes (ADR-0103: `lookup-id`, `import-id`).
 *
 * The rule that keeps the right item saved: an article page gets a button only when its own
 * metadata or address names the article — `citation_doi` and the other tags `paperFrom` reads,
 * the arXiv id in an abstract's address, the PMID in a PubMed article's address. A title alone
 * is not enough, and links on the page are never followed or guessed from: an MDPI issue page,
 * which lists 172 articles and is no article itself, gets no button (Jenni saved the issue).
 *
 * Pure, so it is tested without a browser.
 */

import type { ListItem } from './lists.js';
import {
  arxivDoi,
  arxivIdFromPageUrl,
  cleanArxivId,
  cleanDoi,
  cleanPmid,
  clip,
  doiCandidates,
  openLicence,
  type PageMeta,
  type Paper,
  paperFrom,
  pmidFromUrl,
  referenceLine,
} from './paper.js';

export type RefKind = 'doi' | 'arxiv' | 'pmid';

/** One identifier, already checked: a DOI, an arXiv id without its version, or a PMID. */
export type PaperRef = { kind: RefKind; id: string };

/** What the paste-an-ID routes take: `10.…`, `arXiv:2410.08098`, `PMID 31452104`. */
export function refQuery(ref: PaperRef): string {
  return ref.kind === 'doi' ? ref.id : ref.kind === 'arxiv' ? `arXiv:${ref.id}` : `PMID ${ref.id}`;
}

/** How the card names it. */
export function refLabel(ref: PaperRef): string {
  return ref.kind === 'doi'
    ? `DOI ${ref.id}`
    : ref.kind === 'arxiv'
      ? `arXiv:${ref.id}`
      : `PMID ${ref.id}`;
}

/** A DOI as a ref; arXiv's own DOIs (`10.48550/arxiv.…`) are the arXiv id they stand for. */
export function doiRef(value: string | null | undefined): PaperRef | null {
  const doi = value ? cleanDoi(value) : null;
  if (!doi) return null;
  const arxiv = /^10\.48550\/arxiv\.(.+)$/i.exec(doi)?.[1];
  if (arxiv) {
    const id = cleanArxivId(arxiv);
    return id ? { kind: 'arxiv', id } : null;
  }
  return { kind: 'doi', id: doi };
}

/**
 * The DOI's ref, then the refs of the shorter DOIs an address may really mean (`doiCandidates`):
 * a Scholar result linking `…/doi/10.1108/IJESM-05-2025-0048/1343209` is looked up as that, then
 * as `10.1108/IJESM-05-2025-0048`, and the first one the library has a record for is saved.
 */
export function doiRefs(value: string | null | undefined): PaperRef[] {
  const first = doiRef(value);
  if (first?.kind !== 'doi') return first ? [first] : [];
  return doiCandidates(first.id)
    .map((doi) => doiRef(doi))
    .filter((ref): ref is PaperRef => Boolean(ref));
}

/**
 * A ref from somewhere untrusted — a content script's message — or null. It is accepted only if
 * it is exactly what the cleaners would make of it, so nothing but an identifier gets through.
 */
export function checkRef(value: unknown): PaperRef | null {
  if (!value || typeof value !== 'object') return null;
  const { kind, id } = value as { kind?: unknown; id?: unknown };
  if (typeof id !== 'string' || id.length > 200) return null;
  if (kind === 'doi') {
    const ref = doiRef(id);
    return ref?.kind === 'doi' && ref.id === id ? ref : null;
  }
  if (kind === 'arxiv') return cleanArxivId(id) === id ? { kind, id } : null;
  if (kind === 'pmid') return cleanPmid(id) === id ? { kind, id } : null;
  return null;
}

/** The DOI that names the same paper, for matching links on the page; null for a bare PMID. */
export function refDoi(ref: PaperRef): string | null {
  return ref.kind === 'doi' ? ref.id.toLowerCase() : ref.kind === 'arxiv' ? arxivDoi(ref.id) : null;
}

const unique = (refs: Array<PaperRef | null>): PaperRef[] => {
  const seen = new Set<string>();
  const out: PaperRef[] = [];
  for (const ref of refs) {
    if (!ref) continue;
    const key = `${ref.kind}:${ref.id.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
};

/** The refs of a result on a results page, strongest first. Empty: it is saved by its text. */
export function refsOfItem(item: Pick<ListItem, 'doi' | 'pmid'>): PaperRef[] {
  return unique([...doiRefs(item.doi), item.pmid ? pmidRef(item.pmid) : null]);
}

function pmidRef(value: string): PaperRef | null {
  const id = cleanPmid(value);
  return id ? { kind: 'pmid', id } : null;
}

const metaValue = (page: PageMeta, name: string): string | null =>
  page.meta.find(([key, value]) => key === name && value.trim())?.[1].trim() ?? null;

/** The article a page is about, as the button will save it. */
export type ArticleOnPage = {
  paper: Paper;
  /** The identifiers to ask the library for, in order: the first it finds a record for wins. */
  refs: PaperRef[];
  /** Every DOI (lower case) that names this article: a link to one of these is "its DOI". */
  dois: string[];
  /** The page names a PDF of the article (`citation_pdf_url`). Never fetched by the add-on. */
  pdfOnPage: boolean;
  /** "Open access (CC BY 4.0)" when the page's tags give it a Creative Commons licence. */
  licence: string | null;
};

/**
 * The article on the page, or null when the page's own metadata and address name no article —
 * a results page, an issue's table of contents, a journal's home page.
 *
 * - An arXiv abstract: its arXiv id (the e-print the page is about), then a journal DOI the
 *   authors added, if any.
 * - A PubMed article: the DOI in its tags, if any, then its PMID — the library reads PubMed's
 *   record by PMID even when there is no DOI.
 * - Anything else: the DOI `paperFrom` reads from the tags (`citation_doi` first) or the address.
 */
export function articleOnPage(page: PageMeta): ArticleOnPage | null {
  const arxivId =
    arxivIdFromPageUrl(page.url) ?? cleanArxivId(metaValue(page, 'citation_arxiv_id') ?? '');
  const pmid = pmidFromUrl(page.url) ?? (onPubmed(page.url) ? pmidOf(page) : null);
  const tagged = paperFrom(page);
  const refs = unique([
    arxivId ? { kind: 'arxiv', id: arxivId } : null,
    ...doiRefs(tagged?.doi),
    pmid ? { kind: 'pmid', id: pmid } : null,
  ]);
  if (refs.length === 0) return null;

  const firstDoi = refs.map(refDoi).find((doi): doi is string => Boolean(doi)) ?? null;
  const paper: Paper = tagged
    ? { ...tagged, doi: tagged.doi ?? firstDoi }
    : (() => {
        // A PubMed article whose page carries no citation tags: named by its PMID alone.
        const title = clip(
          metaValue(page, 'og:title') ?? page.title.replace(/\s+-\s+PubMed\s*$/i, ''),
          500,
        );
        return {
          title: title || refLabel(refs[0] as PaperRef),
          doi: firstDoi,
          reference: referenceLine({
            byline: null,
            year: null,
            title: title || null,
            venue: null,
            doi: firstDoi,
          }),
          byline: null,
          year: null,
          venue: null,
        };
      })();

  const dois = [
    ...new Set(
      [...refs.map(refDoi), tagged?.doi?.toLowerCase() ?? null].filter((doi): doi is string =>
        Boolean(doi),
      ),
    ),
  ];
  const pdf = metaValue(page, 'citation_pdf_url');
  return {
    paper,
    refs,
    dois,
    pdfOnPage: Boolean(pdf && /^https?:\/\//i.test(pdf)),
    licence: openLicence(page),
  };
}

const onPubmed = (url: string): boolean => {
  try {
    return new URL(url).hostname.toLowerCase() === 'pubmed.ncbi.nlm.nih.gov';
  } catch {
    return false;
  }
};

/** PubMed's own tag for its id, on an article page whose address did not carry it. */
const pmidOf = (page: PageMeta): string | null => cleanPmid(metaValue(page, 'citation_pmid') ?? '');
