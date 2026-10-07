import { describe, expect, it } from 'vitest';
import { detectPaperId, OpenLibraryClient, validIsbn } from '../src/scholarly/ids.js';

describe('a pasted identifier (Jenni build plan R16)', () => {
  it.each([
    ['10.1016/j.enpol.2021.112345', { kind: 'doi', id: '10.1016/j.enpol.2021.112345' }],
    ['doi: 10.1038/s42949-025-00271-3', { kind: 'doi', id: '10.1038/s42949-025-00271-3' }],
    ['https://doi.org/10.1029/2025EF006167.', { kind: 'doi', id: '10.1029/2025EF006167' }],
    ['10.48550/arXiv.1706.03762', { kind: 'arxiv', id: '1706.03762' }],
    ['arXiv:2410.08098v2', { kind: 'arxiv', id: '2410.08098' }],
    ['https://arxiv.org/abs/2410.08098v1', { kind: 'arxiv', id: '2410.08098' }],
    ['https://arxiv.org/pdf/1706.03762.pdf', { kind: 'arxiv', id: '1706.03762' }],
    ['hep-th/9901001', { kind: 'arxiv', id: 'hep-th/9901001' }],
    ['PMID: 31452104', { kind: 'pmid', id: '31452104' }],
    ['https://pubmed.ncbi.nlm.nih.gov/31452104/', { kind: 'pmid', id: '31452104' }],
    ['978-0-262-03384-8', { kind: 'isbn', id: '9780262033848' }],
    ['ISBN 0-262-03384-4', { kind: 'isbn', id: '0262033844' }],
  ])('%s', (input, expected) => {
    expect(detectPaperId(input)).toEqual(expected);
  });

  it('is nothing when it is not one', () => {
    expect(detectPaperId('rooftop solar adoption')).toBeNull();
    expect(detectPaperId('978-0-262-03384-9')).toBeNull(); // wrong check digit
    expect(detectPaperId('')).toBeNull();
  });

  it('checks ISBN check digits', () => {
    expect(validIsbn('080442957X')).toBe('080442957X');
    expect(validIsbn('9780262033848')).toBe('9780262033848');
    expect(validIsbn('9780262033849')).toBeNull();
  });

  it('reads a book from Open Library, names split as people', async () => {
    const client = new OpenLibraryClient({
      mailto: 'test@example.com',
      fetch: async () =>
        new Response(
          JSON.stringify({
            'ISBN:9780262033848': {
              title: 'Introduction to Algorithms',
              authors: [{ name: 'Thomas H. Cormen' }, { name: 'Clifford Stein' }],
              publishers: [{ name: 'The MIT Press' }],
              publish_date: 'July 31, 2009',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      sleep: async () => undefined,
    });
    expect(await client.byIsbn('9780262033848')).toEqual({
      title: 'Introduction to Algorithms',
      authors: [
        { family: 'Cormen', given: 'Thomas H.' },
        { family: 'Stein', given: 'Clifford' },
      ],
      publisher: 'The MIT Press',
      year: 2009,
      isbn: '9780262033848',
    });
  });
});
