/**
 * Runs inside the student's tab, and only when they click the add-on (ADR-0031: `activeTab`, no
 * content script on every page). Chrome serialises these functions into the page, so each must
 * not refer to anything outside itself — no imports, no module-level names, helpers declared
 * inside.
 *
 * They return the address, the title, the meta tags and — on a results page of PubMed, arXiv or
 * Google Scholar — the identifiers and titles of the results shown (ADR-0069). Never the page's
 * text otherwise. Every value is untrusted and is checked again by the pure code in `paper.ts`
 * and `lists.ts` before anything is sent anywhere.
 */

import type { RawListing } from './lists.js';
import type { PageMeta } from './paper.js';

export function collectPageMeta(): PageMeta {
  const meta: Array<[string, string]> = [];
  for (const element of Array.from(document.querySelectorAll('meta'))) {
    const name =
      element.getAttribute('name') ??
      element.getAttribute('property') ??
      element.getAttribute('itemprop');
    const content = element.getAttribute('content');
    if (name && content) meta.push([name.trim().toLowerCase(), content.slice(0, 2_000)]);
    if (meta.length >= 500) break;
  }
  return {
    url: location.href,
    title: document.title.slice(0, 500),
    meta,
    contentType: document.contentType.slice(0, 100),
  };
}

/**
 * The results listed on a PubMed search, an arXiv listing or search, or a Google Scholar results
 * page — only what each result shows (its title, its byline line, the id or link it carries).
 * Nothing is fetched: Google Scholar in particular is read as it is on the screen, never asked
 * for more. `host` is for the tests; in the tab it is the page's own.
 *
 * `withNodes` is for the in-page buttons (ADR-0125), which run in the page and put a button on
 * each result: it adds the result's element to each item. The popup never asks for it — an
 * element cannot cross back from `chrome.scripting`.
 */
export function collectResultList(
  host: string = location.hostname,
  withNodes = false,
): RawListing | null {
  const MAX = 100;
  const text = (node: Element | null | undefined, max = 600): string =>
    (node?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const attr = (node: Element | null | undefined, name: string, max = 600): string =>
    (node?.getAttribute(name) ?? '').trim().slice(0, max);
  // Links are made absolute against the page (or, in a test, against the host it stands for).
  const base = host === location.hostname ? location.href : `https://${host}/`;
  const href = (node: Element | null | undefined): string => {
    const value = attr(node, 'href', 2_000);
    if (!value) return '';
    try {
      return new URL(value, base).href;
    } catch {
      return '';
    }
  };

  const items: RawListing['items'] = [];
  const lower = host.toLowerCase();

  if (lower === 'pubmed.ncbi.nlm.nih.gov') {
    for (const article of Array.from(document.querySelectorAll('article.full-docsum'))) {
      const link = article.querySelector('a.docsum-title');
      items.push({
        title: text(link),
        byline: text(article.querySelector('.docsum-authors.full-authors')),
        citation: text(article.querySelector('.docsum-journal-citation.full-journal-citation')),
        pmid: attr(link, 'data-article-id', 20) || text(article.querySelector('.docsum-pmid'), 20),
        arxivId: '',
        href: href(link),
        ...(withNodes ? { node: article } : {}),
      });
      if (items.length >= MAX) break;
    }
    return items.length ? { site: 'pubmed', items } : null;
  }

  if (lower === 'arxiv.org' || lower === 'www.arxiv.org') {
    // A listing (/list/…): <dt> with the abstract link, then <dd> with the title and authors.
    for (const dt of Array.from(document.querySelectorAll('dl dt'))) {
      const abs = dt.querySelector('a[title="Abstract"]');
      if (!abs) continue;
      const dd = dt.nextElementSibling;
      const meta = dd?.tagName === 'DD' ? dd : null;
      items.push({
        title: text(meta?.querySelector('.list-title')).replace(/^Title:\s*/i, ''),
        byline: text(meta?.querySelector('.list-authors')),
        citation: '',
        pmid: '',
        arxivId: (attr(abs, 'href', 200).split('/abs/')[1] ?? attr(abs, 'id', 50)).slice(0, 50),
        href: href(abs),
        ...(withNodes ? { node: dt } : {}),
      });
      if (items.length >= MAX) break;
    }
    // A search (/search/…): one <li class="arxiv-result"> per paper.
    for (const result of Array.from(document.querySelectorAll('li.arxiv-result'))) {
      if (items.length >= MAX) break;
      const abs = result.querySelector('p.list-title a');
      const link = href(abs);
      items.push({
        title: text(result.querySelector('p.title')),
        byline: text(result.querySelector('p.authors')).replace(/^Authors:\s*/i, ''),
        citation: text(result.querySelector('p.is-size-7'), 200),
        pmid: '',
        arxivId: (link.split('/abs/')[1] ?? '').slice(0, 50),
        href: link,
        ...(withNodes ? { node: result } : {}),
      });
    }
    return items.length ? { site: 'arxiv', items } : null;
  }

  if (/^scholar\.google\.[a-z.]+$/.test(lower)) {
    for (const result of Array.from(document.querySelectorAll('div.gs_r.gs_or[data-cid]'))) {
      const heading = result.querySelector('h3.gs_rt');
      if (!heading) continue;
      // The heading starts with labels like "[PDF]" or "[CITATION]" in their own spans.
      const clone = heading.cloneNode(true) as Element;
      for (const label of Array.from(clone.querySelectorAll('.gs_ctc, .gs_ctg2, .gs_ctu'))) {
        label.remove();
      }
      items.push({
        title: text(clone).replace(/^(\[[A-Z]+\]\s*)+/, ''),
        byline: text(result.querySelector('.gs_a')),
        citation: '',
        pmid: '',
        arxivId: '',
        href: href(heading.querySelector('a[href]')),
        ...(withNodes ? { node: result } : {}),
      });
      if (items.length >= MAX) break;
    }
    return items.length ? { site: 'scholar', items } : null;
  }

  return null;
}
