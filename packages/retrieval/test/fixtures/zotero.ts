/**
 * Zotero Web API v3 responses for the import tests — ADR-0062.
 *
 * NOT recorded from a live call: there is no Zotero account or key in this project. They are
 * written from Zotero's documented response format and trimmed to the fields the client reads:
 *
 *   - the envelope of a multi-object `format=json` response (an array of objects, each with
 *     top-level `key`, `version`, `library`, `links` and `meta`), from the v3 basics and
 *     "changes from v2" pages;
 *   - `data` (the editable fields: `itemType`, `title`, `extra`, …) and `csljson` (the CSL item)
 *     as the dataserver writes them for `include=data,csljson` (`model/Item.inc.php`);
 *   - a collection's `meta.numItems` and `data.name` / `data.parentCollection`
 *     (`model/Collection.inc.php`);
 *   - CSL fields from the CSL-JSON schema.
 *
 * Nothing here is a field the documentation or the dataserver source does not name. Replace with
 * a recorded response when a key is available (docs/PENDING.md).
 */

export const USER_ID = '4419137';

const library = {
  type: 'user',
  id: 4419137,
  name: 'student',
  links: { alternate: { href: 'https://www.zotero.org/student', type: 'text/html' } },
};

const item = (key: string, data: Record<string, unknown>, csljson: Record<string, unknown>) => ({
  key,
  version: 120,
  library,
  links: {
    self: {
      href: `https://api.zotero.org/users/${USER_ID}/items/${key}`,
      type: 'application/json',
    },
  },
  meta: { numChildren: 0 },
  data: { key, version: 120, ...data },
  csljson,
});

/** A journal article with a DOI. */
export const ARTICLE = item(
  'X2BQ6C5V',
  { itemType: 'journalArticle', title: 'Solar drying of marine fish in coastal Tamil Nadu' },
  {
    type: 'article-journal',
    title: 'Solar drying of marine fish in coastal Tamil Nadu',
    author: [
      { family: 'Kumar', given: 'A.' },
      { family: 'Raman', given: 'S.' },
    ],
    issued: { 'date-parts': [[2021, 3]] },
    'container-title': 'Renewable Energy',
    DOI: '10.1016/j.renene.2021.01.001',
  },
);

/** A book chapter without a DOI, with an institutional author. */
export const CHAPTER = item(
  'K8MZ4R2A',
  { itemType: 'bookSection', title: 'Post-harvest losses in small fisheries' },
  {
    type: 'chapter',
    title: 'Post-harvest losses in small fisheries',
    author: [{ literal: 'Food and Agriculture Organization' }],
    issued: { 'date-parts': [['2019']] },
    'container-title': 'The State of World Fisheries',
    publisher: 'FAO',
  },
);

/** A report whose DOI Zotero keeps in Extra (the type has no DOI field). */
export const REPORT_WITH_EXTRA_DOI = item(
  'P3TD9W7E',
  {
    itemType: 'report',
    title: 'Fish drying practices survey',
    extra: 'DOI: 10.5281/zenodo.1234567\ntex.note: field survey',
  },
  {
    type: 'report',
    title: 'Fish drying practices survey',
    author: [{ family: 'Iyer', given: 'M.' }],
    issued: { 'date-parts': [[2018]] },
    publisher: 'Fisheries Institute',
  },
);

/** A standalone note: not a reference, left out. */
export const NOTE = item(
  'N7QV2H4C',
  { itemType: 'note', note: '<p>Remember to check the 2019 survey.</p>' },
  { type: 'document' },
);

/** A reference with neither a title nor a DOI: nothing to look it up by. */
export const UNTITLED = item(
  'U5RS8J1F',
  { itemType: 'document', title: '' },
  { type: 'document', author: [{ family: 'Anon' }] },
);

export const COLLECTIONS = [
  {
    key: 'BCDF2345',
    version: 88,
    library,
    links: {
      self: {
        href: `https://api.zotero.org/users/${USER_ID}/collections/BCDF2345`,
        type: 'application/json',
      },
    },
    meta: { numCollections: 1, numItems: 3 },
    data: {
      key: 'BCDF2345',
      version: 88,
      name: 'Thesis — chapter 2',
      parentCollection: false,
      relations: {},
    },
  },
  {
    key: 'GHJK6789',
    version: 90,
    library,
    links: {
      self: {
        href: `https://api.zotero.org/users/${USER_ID}/collections/GHJK6789`,
        type: 'application/json',
      },
    },
    meta: { numCollections: 0, numItems: 1 },
    data: {
      key: 'GHJK6789',
      version: 90,
      name: 'Drying methods',
      parentCollection: 'BCDF2345',
      relations: {},
    },
  },
];

/** A JSON response with Zotero's paging headers. */
export function zoteroResponse(
  body: unknown,
  headers: { total?: number; next?: string | null } = {},
): Response {
  const h = new Headers({ 'content-type': 'application/json', 'zotero-api-version': '3' });
  if (headers.total !== undefined) h.set('total-results', String(headers.total));
  if (headers.next) h.set('link', `<${headers.next}>; rel="next"`);
  return new Response(JSON.stringify(body), { status: 200, headers: h });
}
