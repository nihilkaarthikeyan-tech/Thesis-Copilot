/**
 * arXiv identifiers and the DOI arXiv registers for each — in a file of their own, with no
 * imports, so the resolver can recognise an arXiv DOI without importing the client (ADR-0020).
 */

/** `http://arxiv.org/abs/2410.08098v1` → `2410.08098`. */
export function arxivIdFromUrl(url: string): string | null {
  const match = /arxiv\.org\/abs\/(.+?)(v\d+)?$/i.exec(url.trim());
  return match?.[1] ?? null;
}

/**
 * The DOI arXiv registers for every e-print (DataCite, 2022 onwards, retroactively). Lower-case,
 * because the rest of the code compares DOIs lower-cased and DOIs are case-insensitive.
 */
export function arxivDoi(id: string): string {
  return `10.48550/arxiv.${id.toLowerCase()}`;
}

/** The arXiv id inside an arXiv DOI, or null for any other DOI. */
export function arxivIdFromDoi(doi: string | null | undefined): string | null {
  const match = /^(?:https?:\/\/(?:dx\.)?doi\.org\/)?10\.48550\/arxiv\.(.+)$/i.exec(
    doi?.trim() ?? '',
  );
  return match?.[1] ?? null;
}

/** Where arXiv asks us to send people: the abstract page, not the PDF. */
export function arxivAbsUrl(id: string): string {
  return `https://arxiv.org/abs/${id}`;
}
