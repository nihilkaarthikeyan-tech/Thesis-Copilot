/**
 * `citationsIn` — the document-to-rows mirror behind the `Citation` table (PHASES 3.5, B.5).
 */

import { describe, expect, it } from 'vitest';
import { citationsIn } from '../src/modules/chapters/citations.js';

const cite = (attrs: Record<string, unknown>) => ({ type: 'citation', attrs });

const doc = (...inline: unknown[]) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Claim ' }, ...inline] }],
});

describe('citationsIn', () => {
  it('lists every citation with a source, in document order', () => {
    const rows = citationsIn(
      doc(
        cite({ key: 'c_a', sourceId: 'src-1', chunkId: 'ch-1', role: 'parenthetical' }),
        { type: 'text', text: ' and ' },
        cite({ key: 'c_b', sourceId: 'src-2', chunkId: null, role: 'narrative', locator: 'p. 4' }),
      ),
    );
    expect(rows).toEqual([
      { nodeKey: 'c_a', sourceId: 'src-1', chunkId: 'ch-1', role: 'parenthetical', locator: null },
      { nodeKey: 'c_b', sourceId: 'src-2', chunkId: null, role: 'narrative', locator: 'p. 4' },
    ]);
  });

  it('skips a node whose source was removed: it is a red-dashed orphan, not a row', () => {
    expect(citationsIn(doc(cite({ key: 'c_gone', sourceId: null })))).toEqual([]);
  });

  it('keeps the first of two nodes sharing a key (a paste inside the chapter)', () => {
    const rows = citationsIn(
      doc(cite({ key: 'c_dup', sourceId: 'src-1' }), cite({ key: 'c_dup', sourceId: 'src-9' })),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sourceId).toBe('src-1');
  });

  it('finds citations nested inside lists, tables and draft blocks', () => {
    const rows = citationsIn({
      type: 'doc',
      content: [
        {
          type: 'draftBlock',
          content: [
            {
              type: 'bulletList',
              content: [
                {
                  type: 'listItem',
                  content: [
                    { type: 'paragraph', content: [cite({ key: 'c_deep', sourceId: 'src-3' })] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(rows.map((r) => r.nodeKey)).toEqual(['c_deep']);
  });

  it('is empty for nothing at all', () => {
    expect(citationsIn(null)).toEqual([]);
    expect(citationsIn({ type: 'doc', content: [] })).toEqual([]);
  });
});
