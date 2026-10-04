/**
 * Zotero Web API v3 responses for `zotero-import.spec.ts` — ADR-0062.
 *
 * NOT recorded from a live call (there is no Zotero key in this project). Written from Zotero's
 * documented response format, trimmed to the fields the client reads, exactly as the fuller set in
 * `packages/retrieval/test/fixtures/zotero.ts` (whose header names each source): a `format=json`
 * array of objects with `key`, `version`, `library`, `links`, `meta`; `data` and `csljson` from
 * `include=data,csljson`; a collection's `meta.numItems`, `data.name`, `data.parentCollection`.
 * Nothing here is a field the documentation or the dataserver source does not name.
 */

export const USER_ID = '4419137';

const library = { type: 'user', id: 4419137, name: 'student', links: {} };

export const item = (
  key: string,
  data: Record<string, unknown>,
  csljson: Record<string, unknown>,
) => ({
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

export const ITEMS = [
  item(
    'X2BQ6C5V',
    { itemType: 'journalArticle', title: 'Solar drying of marine fish in coastal Tamil Nadu' },
    {
      type: 'article-journal',
      title: 'Solar drying of marine fish in coastal Tamil Nadu',
      author: [
        { family: 'Kumar', given: 'A.' },
        { family: 'Raman', given: 'S.' },
      ],
      issued: { 'date-parts': [[2021]] },
      'container-title': 'Renewable Energy',
      DOI: '10.1016/j.renene.2021.01.001',
    },
  ),
  item(
    'K8MZ4R2A',
    { itemType: 'bookSection', title: 'Post-harvest losses in small fisheries' },
    {
      type: 'chapter',
      title: 'Post-harvest losses in small fisheries',
      author: [{ literal: 'Food and Agriculture Organization' }],
      issued: { 'date-parts': [[2019]] },
      'container-title': 'The State of World Fisheries',
    },
  ),
  item(
    'Q4WE7T9Y',
    { itemType: 'journalArticle', title: 'Moisture loss in tray dryers' },
    {
      type: 'article-journal',
      title: 'Moisture loss in tray dryers',
      author: [{ family: 'Iyer', given: 'M.' }],
      issued: { 'date-parts': [[2018]] },
      'container-title': 'Drying Technology',
      DOI: '10.1080/07373937.2018.1000001',
    },
  ),
  // A standalone note: not a reference.
  item(
    'N7QV2H4C',
    { itemType: 'note', note: '<p>Check the 2019 survey.</p>' },
    { type: 'document' },
  ),
];

export const COLLECTIONS = [
  {
    key: 'BCDF2345',
    version: 88,
    library,
    links: {},
    meta: { numCollections: 0, numItems: 2 },
    data: {
      key: 'BCDF2345',
      version: 88,
      name: 'Chapter 2 reading',
      parentCollection: false,
      relations: {},
    },
  },
];

export function zoteroResponse(body: unknown, total?: number): Response {
  const headers = new Headers({ 'content-type': 'application/json', 'zotero-api-version': '3' });
  if (total !== undefined) headers.set('total-results', String(total));
  return new Response(JSON.stringify(body), { status: 200, headers });
}
